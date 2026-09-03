import type postgres from "postgres";

/**
 * Session advisory single-flight for media upload (actorId + idempotencyKey).
 * Implementations must bind to the same database authority as the injected Database.
 */
export type MediaUploadIdempotencyLock = {
  withLock<T>(
    uploaderId: string,
    idempotencyKey: string,
    run: () => Promise<T>,
  ): Promise<T>;
};

type PostgresSql = ReturnType<typeof postgres>;

/**
 * Adapter over an existing postgres.js pool/client (no connection creation).
 * Reserves one session for the lock only; callers run scan/reencode/object I/O outside DB TX.
 */
export function createPostgresMediaUploadIdempotencyLock(
  sql: PostgresSql,
): MediaUploadIdempotencyLock {
  return {
    async withLock(uploaderId, idempotencyKey, run) {
      const reserved = await sql.reserve();
      const lockName = `media.upload:${uploaderId}:${idempotencyKey}`;
      try {
        await reserved`SELECT pg_advisory_lock(hashtext(${lockName}))`;
        try {
          return await run();
        } finally {
          await reserved`SELECT pg_advisory_unlock(hashtext(${lockName}))`;
        }
      } finally {
        reserved.release();
      }
    },
  };
}
