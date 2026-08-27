import { config } from "dotenv";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  auditEvents,
  outboxEvents,
  pointBalanceProjection,
  pointLedgerEntries,
  scheduleItems,
  settlements,
} from "@/db/schema";
import { completeScheduleItem } from "@/modules/schedule/complete-schedule.service";
import { skipScheduleItem } from "@/modules/schedule/skip-schedule.service";
import { createFormalPlan } from "@/modules/schedule/plan.service";
import { ScheduleError } from "@/modules/schedule/errors";
import { enablePointRule } from "@/modules/settlement/point-rule.service";
import {
  bootstrapParentStudentRelationship,
  DEFAULT_PLAN_BODY,
  enableSchedulePointRule,
  FIXED_NOW,
  resetScheduleTables,
} from "../../helpers/schedule";
import { closeTestDb, getTestDb, migrateTestDb, resetIdentityTables } from "../../helpers/db";

config({ path: ".env.local" });
config({ path: ".env" });

const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("settlement ledger", () => {
  const db = getTestDb();

  beforeAll(async () => {
    await migrateTestDb();
  });

  beforeEach(async () => {
    await resetIdentityTables(db);
    await resetScheduleTables(db);
  });

  afterAll(async () => {
    await closeTestDb();
  });

  async function seedPlanWithRule(options?: { startDate?: string; extraItems?: boolean }) {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);

    const created = await createFormalPlan(db, {
      ownerId: parentId,
      studentId,
      idempotencyKey: `create-settlement-${crypto.randomUUID()}`,
      body: { ...DEFAULT_PLAN_BODY, startDate: options?.startDate ?? "2026-01-15" },
      now: FIXED_NOW,
    });

    await enableSchedulePointRule(db, { parentId, studentId });

    const items = await db
      .select()
      .from(scheduleItems)
      .where(eq(scheduleItems.planId, created.planId))
      .orderBy(scheduleItems.familyDate);

    return { parentId, studentId, created, items };
  }

  it("awards on_time +10 with completion_kind in explanation (AC-M2-4/F4)", async () => {
    const { studentId, items } = await seedPlanWithRule();
    const item = items.find((row) => row.familyDate === "2026-01-15");
    if (!item) throw new Error("Expected item");

    await completeScheduleItem(db, {
      actorId: studentId,
      scheduleItemId: item.id,
      idempotencyKey: "settle-on-time",
      now: FIXED_NOW,
    });

    const [ledger] = await db.select().from(pointLedgerEntries);
    expect(ledger?.amount).toBe(10);
    expect(ledger?.explanation).toContain("completion_kind=on_time");
    expect(ledger?.reason).toBe("schedule_complete");
    expect(ledger?.sourceType).toBe("settlement");
  });

  it("awards late +10 with completion_kind in explanation (AC-M2-5/F15)", async () => {
    const { parentId, studentId, created } = await seedPlanWithRule();

    await db.execute(`
      INSERT INTO schedule_items (
        plan_id, plan_version_id, student_id, owner_id, family_date, slot_key,
        scheduled_at, status, source, occurrence_key
      ) VALUES (
        '${created.planId}', '${created.versionId}', '${studentId}', '${parentId}',
        '2026-01-14', 'default', '2026-01-14T12:00:00Z', 'pending', 'plan', 'manual-late-settlement'
      )
    `);

    const [item] = await db
      .select()
      .from(scheduleItems)
      .where(eq(scheduleItems.occurrenceKey, "manual-late-settlement"))
      .limit(1);

    await completeScheduleItem(db, {
      actorId: studentId,
      scheduleItemId: item!.id,
      idempotencyKey: "settle-late",
      now: new Date("2026-01-15T08:00:00.000Z"),
    });

    const [ledger] = await db.select().from(pointLedgerEntries);
    expect(ledger?.amount).toBe(10);
    expect(ledger?.explanation).toContain("completion_kind=late");
  });

  it("updates balance 0→10 and last_ledger_entry_id on first ledger (C9)", async () => {
    const { studentId, items } = await seedPlanWithRule();
    const item = items.find((row) => row.familyDate === "2026-01-15");
    if (!item) throw new Error("Expected item");

    const result = await completeScheduleItem(db, {
      actorId: studentId,
      scheduleItemId: item.id,
      idempotencyKey: "settle-balance",
      now: FIXED_NOW,
    });

    const [balance] = await db
      .select()
      .from(pointBalanceProjection)
      .where(eq(pointBalanceProjection.studentId, studentId));

    expect(balance?.balance).toBe(10);
    expect(balance?.lastLedgerEntryId).toBe(result.ledgerEntryId);
  });

  it("replays complete with same ledger and unchanged balance (F25)", async () => {
    const { studentId, items } = await seedPlanWithRule();
    const item = items.find((row) => row.familyDate === "2026-01-15");
    if (!item) throw new Error("Expected item");

    const first = await completeScheduleItem(db, {
      actorId: studentId,
      scheduleItemId: item.id,
      idempotencyKey: "settle-replay",
      now: FIXED_NOW,
    });

    const replay = await completeScheduleItem(db, {
      actorId: studentId,
      scheduleItemId: item.id,
      idempotencyKey: "settle-replay",
      now: FIXED_NOW,
    });

    expect(replay.idempotentReplay).toBe(true);
    expect(replay.ledgerEntryId).toBe(first.ledgerEntryId);
    expect(replay.settlementId).toBe(first.settlementId);

    const ledger = await db.select().from(pointLedgerEntries);
    expect(ledger).toHaveLength(1);

    const [balance] = await db
      .select()
      .from(pointBalanceProjection)
      .where(eq(pointBalanceProjection.studentId, studentId));
    expect(balance?.balance).toBe(10);
  });

  it("does not double-count balance on settlement/ledger conflict (C9)", async () => {
    const { studentId, items } = await seedPlanWithRule();
    const item = items.find((row) => row.familyDate === "2026-01-15");
    if (!item) throw new Error("Expected item");

    const results = await Promise.allSettled([
      completeScheduleItem(db, {
        actorId: studentId,
        scheduleItemId: item.id,
        idempotencyKey: "settle-concurrent",
        now: FIXED_NOW,
      }),
      completeScheduleItem(db, {
        actorId: studentId,
        scheduleItemId: item.id,
        idempotencyKey: "settle-concurrent",
        now: FIXED_NOW,
      }),
    ]);

    expect(results.every((result) => result.status === "fulfilled")).toBe(true);

    const ledger = await db.select().from(pointLedgerEntries);
    expect(ledger).toHaveLength(1);

    const [balance] = await db
      .select()
      .from(pointBalanceProjection)
      .where(eq(pointBalanceProjection.studentId, studentId));
    expect(balance?.balance).toBe(10);
  });

  it("allows same client key across different schedule items (F13/F25)", async () => {
    const { parentId, studentId, created, items } = await seedPlanWithRule();
    const itemJan15 = items.find((row) => row.familyDate === "2026-01-15");
    if (!itemJan15) throw new Error("Expected today item");

    await db.execute(`
      INSERT INTO schedule_items (
        plan_id, plan_version_id, student_id, owner_id, family_date, slot_key,
        scheduled_at, status, source, occurrence_key
      ) VALUES (
        '${created.planId}', '${created.versionId}', '${studentId}', '${parentId}',
        '2026-01-14', 'default', '2026-01-14T12:00:00Z', 'pending', 'plan', 'shared-key-second-item'
      )
    `);

    const [itemJan14] = await db
      .select()
      .from(scheduleItems)
      .where(eq(scheduleItems.occurrenceKey, "shared-key-second-item"))
      .limit(1);

    if (!itemJan14) throw new Error("Expected second item");

    await completeScheduleItem(db, {
      actorId: studentId,
      scheduleItemId: itemJan14.id,
      idempotencyKey: "shared-client-key",
      now: FIXED_NOW,
    });

    await completeScheduleItem(db, {
      actorId: studentId,
      scheduleItemId: itemJan15.id,
      idempotencyKey: "shared-client-key",
      now: FIXED_NOW,
    });

    const ledger = await db.select().from(pointLedgerEntries);
    expect(ledger).toHaveLength(2);

    const [balance] = await db
      .select()
      .from(pointBalanceProjection)
      .where(eq(pointBalanceProjection.studentId, studentId));
    expect(balance?.balance).toBe(20);
  });

  it("sets source_id equal to settlement_id (R4)", async () => {
    const { studentId, items } = await seedPlanWithRule();
    const item = items.find((row) => row.familyDate === "2026-01-15");
    if (!item) throw new Error("Expected item");

    const result = await completeScheduleItem(db, {
      actorId: studentId,
      scheduleItemId: item.id,
      idempotencyKey: "settle-source-id",
      now: FIXED_NOW,
    });

    const [ledger] = await db
      .select()
      .from(pointLedgerEntries)
      .where(eq(pointLedgerEntries.id, result.ledgerEntryId!));

    expect(ledger?.sourceId).toBe(result.settlementId);
    expect(ledger?.settlementId).toBe(result.settlementId);
  });

  it("skip produces no ledger (F17)", async () => {
    const { studentId, items } = await seedPlanWithRule();
    const item = items.find((row) => row.familyDate === "2026-01-15");
    if (!item) throw new Error("Expected item");

    await skipScheduleItem(db, {
      actorId: studentId,
      scheduleItemId: item.id,
      idempotencyKey: "skip-no-ledger",
      now: FIXED_NOW,
    });

    const ledger = await db.select().from(pointLedgerEntries);
    expect(ledger).toHaveLength(0);
  });

  it("window-outside complete produces no ledger (F7)", async () => {
    const { parentId, studentId, created } = await seedPlanWithRule();

    await db.execute(`
      INSERT INTO schedule_items (
        plan_id, plan_version_id, student_id, owner_id, family_date, slot_key,
        scheduled_at, status, source, occurrence_key
      ) VALUES (
        '${created.planId}', '${created.versionId}', '${studentId}', '${parentId}',
        '2026-01-01', 'default', '2026-01-01T12:00:00Z', 'pending', 'plan', 'manual-expired-settlement'
      )
    `);

    const [item] = await db
      .select()
      .from(scheduleItems)
      .where(eq(scheduleItems.occurrenceKey, "manual-expired-settlement"))
      .limit(1);

    await expect(
      completeScheduleItem(db, {
        actorId: studentId,
        scheduleItemId: item!.id,
        idempotencyKey: "complete-expired-settlement",
        now: FIXED_NOW,
      }),
    ).rejects.toMatchObject({ code: "WINDOW_EXPIRED" satisfies ScheduleError["code"] });

    const ledger = await db.select().from(pointLedgerEntries);
    expect(ledger).toHaveLength(0);
  });

  it("completed item with different key produces no new ledger (F3)", async () => {
    const { studentId, items } = await seedPlanWithRule();
    const item = items.find((row) => row.familyDate === "2026-01-15");
    if (!item) throw new Error("Expected item");

    await completeScheduleItem(db, {
      actorId: studentId,
      scheduleItemId: item.id,
      idempotencyKey: "settle-first-key",
      now: FIXED_NOW,
    });

    await expect(
      completeScheduleItem(db, {
        actorId: studentId,
        scheduleItemId: item.id,
        idempotencyKey: "settle-second-key",
        now: FIXED_NOW,
      }),
    ).rejects.toMatchObject({ code: "STATE_CONFLICT" });

    const ledger = await db.select().from(pointLedgerEntries);
    expect(ledger).toHaveLength(1);
  });

  it("concurrent complete yields single event/fact/settlement/ledger/audit/outbox (F24)", async () => {
    const { studentId, items } = await seedPlanWithRule();
    const item = items.find((row) => row.familyDate === "2026-01-15");
    if (!item) throw new Error("Expected item");

    await Promise.all([
      completeScheduleItem(db, {
        actorId: studentId,
        scheduleItemId: item.id,
        idempotencyKey: "settle-outbox-concurrent",
        now: FIXED_NOW,
      }),
      completeScheduleItem(db, {
        actorId: studentId,
        scheduleItemId: item.id,
        idempotencyKey: "settle-outbox-concurrent",
        now: FIXED_NOW,
      }),
    ]);

    const settlementRows = await db.select().from(settlements);
    expect(settlementRows).toHaveLength(1);

    const ledgerRows = await db.select().from(pointLedgerEntries);
    expect(ledgerRows).toHaveLength(1);

    const ledgerAudits = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "point_ledger.created"));
    expect(ledgerAudits).toHaveLength(1);

    const settledOutbox = await db
      .select()
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.eventType, "points.settled"),
          eq(outboxEvents.dedupeKey, `points.settled:${settlementRows[0]!.id}`),
        ),
      );
    expect(settledOutbox).toHaveLength(1);
  });

  it("enable point rule replays same rule on same key (F11-F13)", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);

    const first = await enablePointRule(db, {
      parentId,
      studentId,
      idempotencyKey: "enable-rule-replay",
      body: { templateId: "schedule_system_complete_v1" },
      now: FIXED_NOW,
    });

    const replay = await enablePointRule(db, {
      parentId,
      studentId,
      idempotencyKey: "enable-rule-replay",
      body: { templateId: "schedule_system_complete_v1" },
      now: FIXED_NOW,
    });

    expect(replay.idempotentReplay).toBe(true);
    expect(replay.ruleId).toBe(first.ruleId);
    expect(replay.ruleVersionId).toBe(first.ruleVersionId);
  });
});
