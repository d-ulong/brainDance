import { config } from "dotenv";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresMediaUploadIdempotencyLock } from "@/modules/family-content/media-upload-idempotency-lock";
import { requireDatabaseUrl } from "@/lib/env";
import {
  closeTestDb,
  getTestDb,
  getTestSqlClient,
  migrateTestDb,
} from "../../helpers/db";

config({ path: ".env.local" });
config({ path: ".env" });

const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);

function createConcurrentBarrier(participants: number) {
  let remaining = participants;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    async wait() {
      remaining -= 1;
      if (remaining === 0) {
        release();
      }
      await gate;
    },
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`timeout:${label}`)), ms);
    }),
  ]);
}

describe.skipIf(!hasDb)("media upload idempotency lock adapter", () => {
  beforeAll(async () => {
    getTestDb();
    await migrateTestDb();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("serializes same actor+key on the shared test database authority", async () => {
    const sqlClient = getTestSqlClient();
    const lock = createPostgresMediaUploadIdempotencyLock(sqlClient);
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstEntered = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = lock.withLock("actor-a", "key-1", async (lockedDb) => {
      await lockedDb.execute(sql`SELECT 1`);
      order.push("first-enter");
      releaseFirst();
      await new Promise((r) => setTimeout(r, 40));
      order.push("first-exit");
      return "first";
    });

    await firstEntered;
    const second = lock.withLock("actor-a", "key-1", async (lockedDb) => {
      await lockedDb.execute(sql`SELECT 1`);
      order.push("second-enter");
      order.push("second-exit");
      return "second";
    });

    await expect(Promise.all([first, second])).resolves.toEqual(["first", "second"]);
    expect(order).toEqual(["first-enter", "first-exit", "second-enter", "second-exit"]);
  });

  it("allows different keys to proceed without waiting on each other", async () => {
    const lock = createPostgresMediaUploadIdempotencyLock(getTestSqlClient());
    let releaseA!: () => void;
    const aEntered = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    let bEntered = false;

    const a = lock.withLock("actor-a", "key-a", async (lockedDb) => {
      await lockedDb.execute(sql`SELECT 1`);
      releaseA();
      await new Promise((r) => setTimeout(r, 50));
      expect(bEntered).toBe(true);
      return "a";
    });
    await aEntered;
    const b = lock.withLock("actor-a", "key-b", async (lockedDb) => {
      await lockedDb.execute(sql`SELECT 1`);
      bEntered = true;
      return "b";
    });

    await expect(Promise.all([a, b])).resolves.toEqual(["a", "b"]);
  });

  it("advances under max=2 pool saturation using only lockedDb (no second connection)", async () => {
    const pool = postgres(requireDatabaseUrl(), {
      max: 2,
      idle_timeout: 5,
      connect_timeout: 10,
    });
    try {
      const lock = createPostgresMediaUploadIdempotencyLock(pool);
      const barrier = createConcurrentBarrier(2);

      const run = (key: string) =>
        lock.withLock("actor-sat", key, async (lockedDb) => {
          await lockedDb.execute(sql`SELECT 1 AS step`);
          await barrier.wait();
          await lockedDb.execute(sql`SELECT 1 AS after_barrier`);
          return key;
        });

      await expect(
        withTimeout(Promise.all([run("key-sat-a"), run("key-sat-b")]), 8_000, "pool-saturation"),
      ).resolves.toEqual(["key-sat-a", "key-sat-b"]);
    } finally {
      await pool.end({ timeout: 5 });
    }
  });

  it("releases session and lock after callback failure so same key can reacquire", async () => {
    const lock = createPostgresMediaUploadIdempotencyLock(getTestSqlClient());
    const key = `err-${Date.now()}`;

    await expect(
      lock.withLock("actor-err", key, async (lockedDb) => {
        await lockedDb.execute(sql`SELECT 1`);
        throw new Error("callback-boom");
      }),
    ).rejects.toThrow("callback-boom");

    await expect(
      withTimeout(
        lock.withLock("actor-err", key, async (lockedDb) => {
          await lockedDb.execute(sql`SELECT 1`);
          return "reacquired";
        }),
        5_000,
        "reacquire-after-error",
      ),
    ).resolves.toBe("reacquired");
  });

  it("releases reserved session when lockedDb initialize throws (max=1 pool)", async () => {
    const pool = postgres(requireDatabaseUrl(), {
      max: 1,
      idle_timeout: 5,
      connect_timeout: 10,
    });
    try {
      const boom = new Error("lockedDb-init-boom");
      const failingLock = createPostgresMediaUploadIdempotencyLock(pool, {
        createLockedDb: () => {
          throw boom;
        },
      });

      await expect(
        failingLock.withLock("actor-init", "key-init", async () => "never"),
      ).rejects.toThrow("lockedDb-init-boom");

      const okLock = createPostgresMediaUploadIdempotencyLock(pool);
      await expect(
        withTimeout(
          okLock.withLock("actor-init", "key-init", async (lockedDb) => {
            await lockedDb.execute(sql`SELECT 1 AS after_init_release`);
            return "recovered";
          }),
          5_000,
          "reserve-after-init-failure",
        ),
      ).resolves.toBe("recovered");
    } finally {
      await pool.end({ timeout: 5 });
    }
  });
});
