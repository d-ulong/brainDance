import { config } from "dotenv";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { outboxEvents, pointLedgerEntries, workerAttempts } from "@/db/schema";
import { appendOutboxEvent } from "@/modules/outbox/append-outbox-event";
import { OutboxError } from "@/modules/outbox/errors";
import {
  claimNextOutboxEvent,
  completeOutboxEvent,
  failOutboxEvent,
  processNextOutboxEvent,
} from "@/modules/outbox/process-outbox-event.service";
import { replayDeadOutboxEvent, listDeadOutboxEvents } from "@/modules/outbox/replay-outbox-event.service";
import { OUTBOX_MAX_ATTEMPTS } from "@/modules/outbox/worker-constants";
import { closeTestDb, getTestDb, migrateTestDb, resetIdentityTables } from "../../helpers/db";
import { bootstrapAdmin } from "../../helpers/identity";

config({ path: ".env.local" });
config({ path: ".env" });

const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);

async function resetOutboxTables(db: ReturnType<typeof getTestDb>) {
  await db.execute(sql`TRUNCATE TABLE worker_attempts, outbox_events RESTART IDENTITY CASCADE`);
}

describe.skipIf(!hasDb)("m3 outbox worker", () => {
  const db = getTestDb();

  beforeAll(async () => {
    await migrateTestDb();
  });

  beforeEach(async () => {
    await resetIdentityTables(db);
    await resetOutboxTables(db);
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("P3-01 claims pending events with lease token", async () => {
    const eventId = await appendOutboxEvent(db, {
      aggregateType: "schedule_item",
      aggregateId: crypto.randomUUID(),
      eventType: "schedule.completed",
      dedupeKey: `dedupe-${crypto.randomUUID()}`,
      payload: { ok: true },
    });

    const claimed = await claimNextOutboxEvent(db, { workerId: "worker-a" });
    expect(claimed?.eventId).toBe(eventId);
    expect(claimed?.leaseToken).toBeTruthy();

    const attempts = await db.select().from(workerAttempts);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.outcome).toBe("leased");
  });

  it("P3-02 rejects completion with stale lease token", async () => {
    const eventId = await appendOutboxEvent(db, {
      aggregateType: "fact",
      aggregateId: crypto.randomUUID(),
      eventType: "fact.confirmed",
      dedupeKey: `dedupe-${crypto.randomUUID()}`,
      payload: {},
    });

    const claimed = await claimNextOutboxEvent(db, { workerId: "worker-a" });
    expect(claimed).toBeTruthy();

    await expect(
      completeOutboxEvent(db, {
        eventId: eventId,
        leaseToken: crypto.randomUUID(),
        attemptNumber: claimed!.attemptNumber,
        workerId: "worker-b",
      }),
    ).rejects.toBeInstanceOf(OutboxError);
  });

  it("P3-03 moves unsupported events through retry to dead", async () => {
    const now = new Date("2026-01-01T00:00:00.000Z");

    const eventId = await appendOutboxEvent(db, {
      aggregateType: "unknown",
      aggregateId: crypto.randomUUID(),
      eventType: "unknown.event",
      eventVersion: 99,
      dedupeKey: `dedupe-${crypto.randomUUID()}`,
      payload: { secret: "must-not-log" },
    });

    for (let i = 0; i < OUTBOX_MAX_ATTEMPTS; i += 1) {
      await db
        .update(outboxEvents)
        .set({ availableAt: now, status: "pending" })
        .where(eq(outboxEvents.id, eventId));

      await processNextOutboxEvent(db, { workerId: "worker-retry", now });
    }

    const [dead] = await db.select().from(outboxEvents).where(eq(outboxEvents.id, eventId));
    expect(dead?.status).toBe("dead");

    const ledgerCount = await db.select().from(pointLedgerEntries);
    expect(ledgerCount).toHaveLength(0);
  });

  it("P3-04 admin can list dead events and replay", async () => {
    const { adminId } = await bootstrapAdmin(db);

    const eventId = await appendOutboxEvent(db, {
      aggregateType: "unknown",
      aggregateId: crypto.randomUUID(),
      eventType: "unknown.event",
      dedupeKey: `dedupe-dead-${crypto.randomUUID()}`,
      payload: {},
    });

    await db
      .update(outboxEvents)
      .set({ status: "dead", attempts: OUTBOX_MAX_ATTEMPTS, lastErrorCode: "unsupported_event" })
      .where(eq(outboxEvents.id, eventId));

    const listed = await listDeadOutboxEvents(db, { limit: 10 });
    expect(listed.events.some((e) => e.id === eventId)).toBe(true);

    const replayed = await replayDeadOutboxEvent(db, {
      eventId,
      actorId: adminId,
      reason: "operator retry after fix",
      idempotencyKey: "replay-1",
    });

    expect(replayed.idempotentReplay).toBe(false);

    const [event] = await db.select().from(outboxEvents).where(eq(outboxEvents.id, eventId));
    expect(event?.status).toBe("pending");
  });

  it("P3-05 emits sanitized structured logs", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await appendOutboxEvent(db, {
      aggregateType: "settlement",
      aggregateId: crypto.randomUUID(),
      eventType: "points.settled",
      dedupeKey: `dedupe-log-${crypto.randomUUID()}`,
      payload: { token: "secret-token", error_count: 5 },
    });

    await processNextOutboxEvent(db, { workerId: "worker-log" });

    const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toContain("outbox_worker");
    expect(output).not.toContain("secret-token");
    expect(output).not.toContain("error_count");
  });
});
