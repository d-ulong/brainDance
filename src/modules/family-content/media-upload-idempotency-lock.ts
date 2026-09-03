import { drizzle } from "drizzle-orm/postgres-js";
import type postgres from "postgres";

import type { Database } from "@/db";
import * as schema from "@/db/schema";

/**
 * Session advisory single-flight for media upload (actorId + idempotencyKey).
 * Implementations must bind to the same database authority as the caller's Database
 * and hand the reserved session to the callback as `lockedDb`.
 */
export type MediaUploadIdempotencyLock = {
  withLock<T>(
    uploaderId: string,
    idempotencyKey: string,
    run: (lockedDb: Database) => Promise<T>,
  ): Promise<T>;
};

type PostgresSql = ReturnType<typeof postgres>;
type ReservedSql = Awaited<ReturnType<PostgresSql["reserve"]>>;

/**
 * Reserved postgres.js sessions omit `options` and `begin`. Drizzle needs both:
 * shared pool `options` for parsers/serializers, and `begin` for `db.transaction()`.
 * Graft onto the reserved session only — never open a second client/pool.
 */
function attachDrizzleSessionSupport(
  reserved: ReservedSql,
  poolSql: PostgresSql,
): void {
  const target = reserved as ReservedSql & {
    options?: unknown;
    begin?: (
      optionsOrFn: unknown,
      maybeFn?: unknown,
    ) => Promise<unknown>;
  };

  if (!target.options) {
    Object.assign(target, { options: poolSql.options });
  }

  if (typeof target.begin === "function") {
    return;
  }

  Object.assign(target, {
    async begin(optionsOrFn: unknown, maybeFn?: unknown) {
      let callback = maybeFn as ((sql: unknown) => Promise<unknown>) | undefined;
      let beginOptions = optionsOrFn;
      if (!callback) {
        callback = optionsOrFn as (sql: unknown) => Promise<unknown>;
        beginOptions = "";
      }

      await reserved.unsafe(
        "begin " + String(beginOptions).replace(/[^a-z ]/gi, ""),
      );

      let savepoints = 0;
      const txSql = Object.assign(
        (strings: TemplateStringsArray, ...args: unknown[]) =>
          (reserved as unknown as (...a: unknown[]) => unknown)(strings, ...args),
        {
          options: target.options,
          types: reserved.types,
          typed: reserved.typed,
          unsafe: reserved.unsafe.bind(reserved),
          array: reserved.array,
          json: reserved.json,
          file: reserved.file,
          async savepoint(nameOrFn: unknown, nestedFn?: unknown) {
            let name: string;
            let nested: (sql: unknown) => Promise<unknown>;
            if (typeof nameOrFn === "function") {
              nested = nameOrFn as (sql: unknown) => Promise<unknown>;
              name = `s${savepoints++}`;
            } else {
              nested = nestedFn as (sql: unknown) => Promise<unknown>;
              name = `s${savepoints++}_${String(nameOrFn)}`;
            }
            await reserved.unsafe(`savepoint ${name}`);
            try {
              return await nested(txSql);
            } catch (error) {
              await reserved.unsafe(`rollback to ${name}`);
              throw error;
            }
          },
        },
      );

      try {
        const result = await callback!(txSql);
        await reserved.unsafe("commit");
        return result;
      } catch (error) {
        try {
          await reserved.unsafe("rollback");
        } catch {
          // Prefer the original callback/begin error.
        }
        throw error;
      }
    },
  });
}

/**
 * Builds lockedDb on a reserved session (same authority; no second client/pool).
 * Injectable for tests that force initialize failure after reserve.
 */
export type LockedDbFactory = (
  reserved: ReservedSql,
  poolSql: PostgresSql,
) => Database;

function createLockedDbFromReserved(
  reserved: ReservedSql,
  poolSql: PostgresSql,
): Database {
  attachDrizzleSessionSupport(reserved, poolSql);
  return drizzle(reserved, { schema }) as Database;
}

/**
 * Adapter over an existing postgres.js pool/client (no connection creation).
 * Reserves one session that carries both the advisory lock and all lock-held DB work.
 * Scan/reencode/object I/O stay outside DB transactions but may run while the lock is held.
 *
 * Control flow: reserve → try/finally guard → initialize → lock → callback → unlock → release.
 * Any initialize / lock / callback failure still releases the reserved session;
 * unlock runs only after lock acquisition succeeds.
 */
export function createPostgresMediaUploadIdempotencyLock(
  sql: PostgresSql,
  options?: { createLockedDb?: LockedDbFactory },
): MediaUploadIdempotencyLock {
  const createLockedDb = options?.createLockedDb ?? createLockedDbFromReserved;
  return {
    async withLock(uploaderId, idempotencyKey, run) {
      const reserved = await sql.reserve();
      const lockName = `media.upload:${uploaderId}:${idempotencyKey}`;
      try {
        const lockedDb = createLockedDb(reserved, sql);
        await reserved`SELECT pg_advisory_lock(hashtext(${lockName}))`;
        try {
          return await run(lockedDb);
        } finally {
          await reserved`SELECT pg_advisory_unlock(hashtext(${lockName}))`;
        }
      } finally {
        reserved.release();
      }
    },
  };
}
