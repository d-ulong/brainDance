import { config } from "dotenv";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { outboxEvents, workerAttempts } from "@/db/schema";
import { appendOutboxEvent } from "@/modules/outbox/append-outbox-event";
import {
  claimOutboxEventById,
  processOutboxEventById,
} from "@/modules/outbox/process-outbox-event.service";
import { OUTBOX_LEASE_DURATION_MS } from "@/modules/outbox/worker-constants";
import { closeTestDb, getTestDb, migrateTestDb, resetIdentityTables } from "../../helpers/db";

config({ path: ".env.local" });
config({ path: ".env" });

const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);

async function resetOutboxTables(db: ReturnType<typeof getTestDb>) {
  await db.execute(sql`TRUNCATE TABLE worker_attempts, outbox_events RESTART IDENTITY CASCADE`);
}

describe.skipIf(!hasDb)("outbox claimOutboxEventById lease rules", () => {
  const db = getTestDb();

  beforeAll(async () => {
    await migrateTestDb();
  });

  beforeEach(async () => {
    await resetIdentityTables(db);
    await resetOutboxTables(db);
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("claims and processes a due pending event by id", async () => {
    const now = new Date("2026-05-01T08:00:00.000Z");
    const eventId = await appendOutboxEvent(db, {
      aggregateType: "schedule_item",
      aggregateId: crypto.randomUUID(),
      eventType: "schedule.completed",
      dedupeKey: `byid-pending-${crypto.randomUUID()}`,
      payload: { ok: true },
      availableAt: now,
    });

    const processed = await processOutboxEventById(db, {
      eventId,
      workerId: "byid-pending-worker",
      now,
    });
    expect(processed.processed).toBe(true);
    expect(processed.noOp).toBe(true);

    const [row] = await db.select().from(outboxEvents).where(eq(outboxEvents.id, eventId)).limit(1);
    expect(row?.status).toBe("processed");
    expect(row?.leaseToken).toBeNull();
    expect(row?.leaseOwner).toBeNull();

    const attempts = await db
      .select()
      .from(workerAttempts)
      .where(eq(workerAttempts.outboxEventId, eventId));
    expect(attempts.some((a) => a.outcome === "success")).toBe(true);
  });

  it("refuses to preempt an unexpired leased event and leaves owner/token/attempt intact", async () => {
    const claimNow = new Date("2026-05-01T09:00:00.000Z");
    const eventId = await appendOutboxEvent(db, {
      aggregateType: "schedule_item",
      aggregateId: crypto.randomUUID(),
      eventType: "schedule.completed",
      dedupeKey: `byid-active-lease-${crypto.randomUUID()}`,
      payload: { ok: true },
      availableAt: claimNow,
    });

    const original = await claimOutboxEventById(db, {
      eventId,
      workerId: "owner-worker",
      now: claimNow,
    });
    expect(original).toBeTruthy();

    const attemptsBefore = await db
      .select()
      .from(workerAttempts)
      .where(eq(workerAttempts.outboxEventId, eventId));
    expect(attemptsBefore).toHaveLength(1);
    expect(attemptsBefore[0]?.leaseToken).toBe(original!.leaseToken);
    expect(attemptsBefore[0]?.outcome).toBe("leased");

    const [before] = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.id, eventId))
      .limit(1);
    expect(before?.status).toBe("leased");
    expect(before?.leaseOwner).toBe("owner-worker");
    expect(before?.leaseToken).toBe(original!.leaseToken);

    const midLease = new Date(claimNow.getTime() + OUTBOX_LEASE_DURATION_MS / 2);
    const stolen = await claimOutboxEventById(db, {
      eventId,
      workerId: "intruder-worker",
      now: midLease,
    });
    expect(stolen).toBeNull();

    const processStolen = await processOutboxEventById(db, {
      eventId,
      workerId: "intruder-worker",
      now: midLease,
    });
    expect(processStolen.processed).toBe(false);

    const [after] = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.id, eventId))
      .limit(1);
    expect(after?.status).toBe("leased");
    expect(after?.leaseOwner).toBe("owner-worker");
    expect(after?.leaseToken).toBe(original!.leaseToken);
    expect(after?.leasedUntil?.toISOString()).toBe(before?.leasedUntil?.toISOString());
    expect(after?.attempts).toBe(before?.attempts);

    const attemptsAfter = await db
      .select()
      .from(workerAttempts)
      .where(eq(workerAttempts.outboxEventId, eventId));
    expect(attemptsAfter).toHaveLength(1);
    expect(attemptsAfter[0]?.leaseToken).toBe(original!.leaseToken);
    expect(attemptsAfter[0]?.outcome).toBe("leased");
  });

  it("reclaims an expired leased event via formal claim-by-id rules", async () => {
    const claimNow = new Date("2026-05-01T10:00:00.000Z");
    const eventId = await appendOutboxEvent(db, {
      aggregateType: "schedule_item",
      aggregateId: crypto.randomUUID(),
      eventType: "schedule.completed",
      dedupeKey: `byid-expired-lease-${crypto.randomUUID()}`,
      payload: { ok: true },
      availableAt: claimNow,
    });

    const original = await claimOutboxEventById(db, {
      eventId,
      workerId: "stale-owner",
      now: claimNow,
    });
    expect(original).toBeTruthy();

    const expiredNow = new Date(claimNow.getTime() + OUTBOX_LEASE_DURATION_MS + 1);
    const reclaimed = await claimOutboxEventById(db, {
      eventId,
      workerId: "reclaim-worker",
      now: expiredNow,
    });
    expect(reclaimed?.eventId).toBe(eventId);
    expect(reclaimed?.leaseToken).toBeTruthy();
    expect(reclaimed?.leaseToken).not.toBe(original!.leaseToken);
    expect(reclaimed!.attemptNumber).toBeGreaterThan(original!.attemptNumber);

    const [row] = await db.select().from(outboxEvents).where(eq(outboxEvents.id, eventId)).limit(1);
    expect(row?.status).toBe("leased");
    expect(row?.leaseOwner).toBe("reclaim-worker");
    expect(row?.leaseToken).toBe(reclaimed!.leaseToken);

    const attempts = await db
      .select()
      .from(workerAttempts)
      .where(eq(workerAttempts.outboxEventId, eventId));
    expect(attempts.length).toBeGreaterThanOrEqual(2);
    expect(
      attempts.some((a) => a.leaseToken === reclaimed!.leaseToken && a.outcome === "leased"),
    ).toBe(true);
  });
});
