import { config } from "dotenv";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import { auditEvents, outboxEvents, pointLedgerEntries, workerAttempts } from "@/db/schema";
import { appendOutboxEvent } from "@/modules/outbox/append-outbox-event";
import { OutboxError } from "@/modules/outbox/errors";
import {
  claimNextOutboxEvent,
  completeOutboxEvent,
  processNextOutboxEvent,
} from "@/modules/outbox/process-outbox-event.service";
import {
  replayDeadOutboxEvent,
  listDeadOutboxEvents,
} from "@/modules/outbox/replay-outbox-event.service";
import {
  computeBackoffMs,
  OUTBOX_LEASE_DURATION_MS,
  OUTBOX_MAX_ATTEMPTS,
} from "@/modules/outbox/worker-constants";
import { requireDatabaseUrl } from "@/lib/env";
import {
  closeTestDb,
  getTestDb,
  migrateTestDb,
  resetIdentityTables,
  type TestDb,
} from "../../helpers/db";
import { bootstrapAdmin } from "../../helpers/identity";

config({ path: ".env.local" });
config({ path: ".env" });

const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);

async function resetOutboxTables(db: ReturnType<typeof getTestDb>) {
  await db.execute(sql`TRUNCATE TABLE worker_attempts, outbox_events RESTART IDENTITY CASCADE`);
}

function createConcurrentBarrier(participants: number) {
  let arrived = 0;
  let release!: () => void;
  const proceed = new Promise<void>((resolve) => {
    release = resolve;
  });

  return {
    async wait(): Promise<void> {
      arrived += 1;
      if (arrived === participants) {
        release();
      }
      await proceed;
    },
    release(): void {
      release();
    },
  };
}

async function withIndependentTransaction<T>(
  fn: (tx: Parameters<Parameters<TestDb["transaction"]>[0]>[0]) => Promise<T>,
): Promise<T> {
  const client = postgres(requireDatabaseUrl(), { max: 1 });
  const independentDb = drizzle(client, { schema });
  try {
    return await independentDb.transaction(fn);
  } finally {
    await client.end({ timeout: 5 });
  }
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
      payload: { studentId: crypto.randomUUID(), ledgerEntryId: crypto.randomUUID() },
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
      payload: { token: "secret-token", error_count: 5, studentId: crypto.randomUUID() },
    });

    await processNextOutboxEvent(db, { workerId: "worker-log" });

    const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toContain("outbox_worker");
    expect(output).not.toContain("secret-token");
    expect(output).not.toContain("error_count");
  });

  it("R03-01 processes fact.submitted as explicit safe delivery", async () => {
    const eventId = await appendOutboxEvent(db, {
      aggregateType: "fact",
      aggregateId: crypto.randomUUID(),
      eventType: "fact.submitted",
      dedupeKey: `dedupe-submitted-${crypto.randomUUID()}`,
      payload: { factVersionId: crypto.randomUUID() },
    });

    const result = await processNextOutboxEvent(db, { workerId: "worker-submitted" });
    expect(result.processed).toBe(true);

    const [event] = await db.select().from(outboxEvents).where(eq(outboxEvents.id, eventId));
    expect(event?.status).toBe("processed");

    const ledgerCount = await db.select().from(pointLedgerEntries);
    expect(ledgerCount).toHaveLength(0);
  });

  it("R03-02 M3 handler repeat and lease-expiry reclaim do not duplicate ledger", async () => {
    const studentId = crypto.randomUUID();
    const eventId = await appendOutboxEvent(db, {
      aggregateType: "fact",
      aggregateId: crypto.randomUUID(),
      eventType: "fact.confirmed",
      dedupeKey: `dedupe-confirmed-${crypto.randomUUID()}`,
      payload: { studentId, ledgerEntryId: crypto.randomUUID() },
    });

    const first = await processNextOutboxEvent(db, { workerId: "worker-m3-first" });
    expect(first.processed).toBe(true);
    expect(await db.select().from(pointLedgerEntries)).toHaveLength(0);

    const eventId2 = await appendOutboxEvent(db, {
      aggregateType: "fact",
      aggregateId: crypto.randomUUID(),
      eventType: "fact.confirmed",
      dedupeKey: `dedupe-confirmed-2-${crypto.randomUUID()}`,
      payload: { studentId, ledgerEntryId: crypto.randomUUID() },
    });

    const claimNow = new Date("2026-01-01T00:01:00.000Z");
    await db
      .update(outboxEvents)
      .set({ availableAt: claimNow })
      .where(eq(outboxEvents.id, eventId2));

    const claimed = await claimNextOutboxEvent(db, {
      workerId: "worker-expired",
      now: claimNow,
    });
    expect(claimed?.eventId).toBe(eventId2);

    const expiredNow = new Date(claimNow.getTime() + OUTBOX_LEASE_DURATION_MS + 1);
    const reclaimed = await claimNextOutboxEvent(db, {
      workerId: "worker-reclaim",
      now: expiredNow,
    });
    expect(reclaimed?.eventId).toBe(eventId2);
    expect(reclaimed?.attemptNumber).toBeGreaterThan(claimed!.attemptNumber);

    await expect(
      completeOutboxEvent(db, {
        eventId: eventId2,
        leaseToken: claimed!.leaseToken,
        attemptNumber: claimed!.attemptNumber,
        workerId: "worker-expired",
        now: expiredNow,
      }),
    ).rejects.toMatchObject({ code: "LEASE_MISMATCH" });

    await db
      .update(outboxEvents)
      .set({ leasedUntil: expiredNow })
      .where(eq(outboxEvents.id, eventId2));

    const second = await processNextOutboxEvent(db, {
      workerId: "worker-m3-second",
      now: new Date(expiredNow.getTime() + 1),
    });
    expect(second.processed).toBe(true);
    expect(await db.select().from(pointLedgerEntries)).toHaveLength(0);

    const [processedFirst] = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.id, eventId));
    expect(processedFirst?.status).toBe("processed");
    const [processedSecond] = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.id, eventId2));
    expect(processedSecond?.status).toBe("processed");
  });

  it("F-R03 claim eligibility uses injected now for lease expiry boundary", async () => {
    const claimNow = new Date("2026-04-01T10:00:00.000Z");
    const boundaryNow = new Date("2026-04-01T11:00:00.000Z");

    const eventId = await appendOutboxEvent(db, {
      aggregateType: "fact",
      aggregateId: crypto.randomUUID(),
      eventType: "fact.confirmed",
      dedupeKey: `dedupe-lease-boundary-${crypto.randomUUID()}`,
      payload: { studentId: crypto.randomUUID(), ledgerEntryId: crypto.randomUUID() },
    });

    await db
      .update(outboxEvents)
      .set({ availableAt: claimNow })
      .where(eq(outboxEvents.id, eventId));

    const claimed = await claimNextOutboxEvent(db, { workerId: "worker-boundary", now: claimNow });
    expect(claimed?.eventId).toBe(eventId);

    await db
      .update(outboxEvents)
      .set({
        status: "leased",
        leasedUntil: new Date(boundaryNow.getTime() - 1),
      })
      .where(eq(outboxEvents.id, eventId));

    const reclaimed = await claimNextOutboxEvent(db, {
      workerId: "worker-boundary-reclaim",
      now: boundaryNow,
    });
    expect(reclaimed?.eventId).toBe(eventId);

    await db
      .update(outboxEvents)
      .set({
        status: "leased",
        leasedUntil: new Date(boundaryNow.getTime() + 1),
        leaseToken: reclaimed!.leaseToken,
        leaseOwner: "worker-boundary-reclaim",
      })
      .where(eq(outboxEvents.id, eventId));

    const blocked = await claimNextOutboxEvent(db, {
      workerId: "worker-boundary-blocked",
      now: boundaryNow,
    });
    expect(blocked).toBeNull();
  });

  it("R04-01 replay uses monotonic attempt sequence and idempotency key", async () => {
    const { adminId } = await bootstrapAdmin(db);
    const now = new Date("2026-02-01T00:00:00.000Z");

    const eventId = await appendOutboxEvent(db, {
      aggregateType: "unknown",
      aggregateId: crypto.randomUUID(),
      eventType: "unknown.event",
      dedupeKey: `dedupe-replay-seq-${crypto.randomUUID()}`,
      payload: {},
    });

    await db
      .update(outboxEvents)
      .set({ status: "dead", attempts: OUTBOX_MAX_ATTEMPTS })
      .where(eq(outboxEvents.id, eventId));

    for (let attempt = 1; attempt <= OUTBOX_MAX_ATTEMPTS; attempt += 1) {
      await db.insert(workerAttempts).values({
        outboxEventId: eventId,
        attemptNumber: attempt,
        outcome: "failure",
        startedAt: now,
        finishedAt: now,
        errorCategory: "unsupported_event",
      });
    }

    const replay1 = await replayDeadOutboxEvent(db, {
      eventId,
      actorId: adminId,
      reason: "manual recovery",
      idempotencyKey: "replay-key-a",
      now,
    });
    expect(replay1.idempotentReplay).toBe(false);

    const replay2 = await replayDeadOutboxEvent(db, {
      eventId,
      actorId: adminId,
      reason: "manual recovery",
      idempotencyKey: "replay-key-a",
      now,
    });
    expect(replay2.idempotentReplay).toBe(true);

    const attempts = await db
      .select()
      .from(workerAttempts)
      .where(eq(workerAttempts.outboxEventId, eventId))
      .orderBy(workerAttempts.attemptNumber);
    expect(attempts).toHaveLength(OUTBOX_MAX_ATTEMPTS + 1);
    expect(attempts.at(-1)?.outcome).toBe("replayed");
    expect(attempts.at(-1)?.replayIdempotencyKey).toBe("replay-key-a");

    const claimed = await claimNextOutboxEvent(db, { workerId: "worker-post-replay", now });
    expect(claimed?.attemptNumber).toBe(OUTBOX_MAX_ATTEMPTS + 2);

    const auditRows = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "outbox.replayed"));
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.metadata).toMatchObject({
      replayReason: "manual recovery",
      replayIdempotencyKey: "replay-key-a",
    });
  });

  it("R04-02 concurrent replay with same idempotency key leaves one replay attempt", async () => {
    const { adminId } = await bootstrapAdmin(db);
    const eventId = await appendOutboxEvent(db, {
      aggregateType: "unknown",
      aggregateId: crypto.randomUUID(),
      eventType: "unknown.event",
      dedupeKey: `dedupe-replay-race-${crypto.randomUUID()}`,
      payload: {},
    });

    await db
      .update(outboxEvents)
      .set({ status: "dead", attempts: OUTBOX_MAX_ATTEMPTS })
      .where(eq(outboxEvents.id, eventId));

    const barrier = createConcurrentBarrier(2);
    const results = await Promise.allSettled([
      withIndependentTransaction(async () => {
        await barrier.wait();
        return replayDeadOutboxEvent(db, {
          eventId,
          actorId: adminId,
          reason: "race replay",
          idempotencyKey: "replay-race-key",
        });
      }),
      withIndependentTransaction(async () => {
        await barrier.wait();
        return replayDeadOutboxEvent(db, {
          eventId,
          actorId: adminId,
          reason: "race replay",
          idempotencyKey: "replay-race-key",
        });
      }),
    ]);
    barrier.release();

    const fulfilled = results.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<{
      idempotentReplay: boolean;
    }>[];
    expect(fulfilled.length).toBe(2);

    const replayAttempts = await db
      .select()
      .from(workerAttempts)
      .where(
        sql`${workerAttempts.outboxEventId} = ${eventId}::uuid AND ${workerAttempts.outcome} = 'replayed'`,
      );
    expect(replayAttempts).toHaveLength(1);
  });

  it("P1-R03-01 processes relationship.ended as supported noop", async () => {
    const eventId = await appendOutboxEvent(db, {
      aggregateType: "relationship",
      aggregateId: crypto.randomUUID(),
      eventType: "relationship.ended",
      dedupeKey: `dedupe-rel-ended-${crypto.randomUUID()}`,
      payload: { relationshipId: crypto.randomUUID() },
    });

    const result = await processNextOutboxEvent(db, { workerId: "worker-rel-ended" });
    expect(result.processed).toBe(true);
    expect(result.noOp).toBe(true);

    const [event] = await db.select().from(outboxEvents).where(eq(outboxEvents.id, eventId));
    expect(event?.status).toBe("processed");
  });

  it("P1-R03-02 processes plan.deactivated as supported noop", async () => {
    const eventId = await appendOutboxEvent(db, {
      aggregateType: "plan",
      aggregateId: crypto.randomUUID(),
      eventType: "plan.deactivated",
      dedupeKey: `dedupe-plan-deactivated-${crypto.randomUUID()}`,
      payload: { planId: crypto.randomUUID() },
    });

    const result = await processNextOutboxEvent(db, { workerId: "worker-plan-deactivated" });
    expect(result.processed).toBe(true);
    expect(result.noOp).toBe(true);

    const [event] = await db.select().from(outboxEvents).where(eq(outboxEvents.id, eventId));
    expect(event?.status).toBe("processed");
  });

  it("P1-R03-03 processes point_rule.deactivated as supported noop", async () => {
    const eventId = await appendOutboxEvent(db, {
      aggregateType: "point_rule",
      aggregateId: crypto.randomUUID(),
      eventType: "point_rule.deactivated",
      dedupeKey: `dedupe-rule-deactivated-${crypto.randomUUID()}`,
      payload: { ruleId: crypto.randomUUID() },
    });

    const result = await processNextOutboxEvent(db, { workerId: "worker-rule-deactivated" });
    expect(result.processed).toBe(true);
    expect(result.noOp).toBe(true);

    const [event] = await db.select().from(outboxEvents).where(eq(outboxEvents.id, eventId));
    expect(event?.status).toBe("processed");
  });

  it("R05-01 failure backoff uses absolute available_at and max-attempt boundary", async () => {
    const now = new Date("2026-03-01T00:00:00.000Z");
    const eventId = await appendOutboxEvent(db, {
      aggregateType: "unknown",
      aggregateId: crypto.randomUUID(),
      eventType: "unknown.event",
      dedupeKey: `dedupe-backoff-${crypto.randomUUID()}`,
      payload: {},
    });

    await db.update(outboxEvents).set({ availableAt: now }).where(eq(outboxEvents.id, eventId));

    await processNextOutboxEvent(db, { workerId: "worker-backoff", now });

    const [afterFirstFail] = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.id, eventId));
    expect(afterFirstFail?.status).toBe("pending");
    expect(afterFirstFail?.attempts).toBe(1);
    expect(afterFirstFail?.availableAt?.toISOString()).toBe(
      new Date(now.getTime() + computeBackoffMs(1)).toISOString(),
    );

    for (let i = 1; i < OUTBOX_MAX_ATTEMPTS; i += 1) {
      await db
        .update(outboxEvents)
        .set({ availableAt: now, status: "pending" })
        .where(eq(outboxEvents.id, eventId));
      await processNextOutboxEvent(db, { workerId: `worker-backoff-${i}`, now });
    }

    const [dead] = await db.select().from(outboxEvents).where(eq(outboxEvents.id, eventId));
    expect(dead?.status).toBe("dead");
    expect(dead?.attempts).toBe(OUTBOX_MAX_ATTEMPTS);

    const attemptRows = await db
      .select()
      .from(workerAttempts)
      .where(eq(workerAttempts.outboxEventId, eventId));
    expect(attemptRows.every((row) => row.outcome === "leased" || row.outcome === "failure")).toBe(
      true,
    );
  });
});
