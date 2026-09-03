import { config } from "dotenv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresMediaUploadIdempotencyLock } from "@/modules/family-content/media-upload-idempotency-lock";
import {
  closeTestDb,
  getTestDb,
  getTestSqlClient,
  migrateTestDb,
} from "../../helpers/db";

config({ path: ".env.local" });
config({ path: ".env" });

const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("media upload idempotency lock adapter", () => {
  beforeAll(async () => {
    getTestDb();
    await migrateTestDb();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("serializes same actor+key on the shared test database authority", async () => {
    const sql = getTestSqlClient();
    const lock = createPostgresMediaUploadIdempotencyLock(sql);
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstEntered = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = lock.withLock("actor-a", "key-1", async () => {
      order.push("first-enter");
      releaseFirst();
      await new Promise((r) => setTimeout(r, 40));
      order.push("first-exit");
      return "first";
    });

    await firstEntered;
    const second = lock.withLock("actor-a", "key-1", async () => {
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

    const a = lock.withLock("actor-a", "key-a", async () => {
      releaseA();
      await new Promise((r) => setTimeout(r, 50));
      expect(bEntered).toBe(true);
      return "a";
    });
    await aEntered;
    const b = lock.withLock("actor-a", "key-b", async () => {
      bEntered = true;
      return "b";
    });

    await expect(Promise.all([a, b])).resolves.toEqual(["a", "b"]);
  });
});
