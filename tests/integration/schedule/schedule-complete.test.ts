import { config } from "dotenv";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { factVersions, pointLedgerEntries, scheduleEvents, scheduleItems } from "@/db/schema";
import {
  completeScheduleItem,
  type SettleForFactFn,
} from "@/modules/schedule/complete-schedule.service";
import { createFormalPlan } from "@/modules/schedule/plan.service";
import { ScheduleError } from "@/modules/schedule/errors";
import {
  bootstrapParentStudentRelationship,
  DEFAULT_PLAN_BODY,
  FIXED_NOW,
  resetScheduleTables,
} from "../../helpers/schedule";
import { closeTestDb, getTestDb, migrateTestDb, resetIdentityTables } from "../../helpers/db";

config({ path: ".env.local" });
config({ path: ".env" });

const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("schedule complete", () => {
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

  async function seedTodayItem() {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);

    await createFormalPlan(db, {
      ownerId: parentId,
      studentId,
      idempotencyKey: "create-complete",
      body: { ...DEFAULT_PLAN_BODY, startDate: "2026-01-15" },
      now: FIXED_NOW,
    });

    const [item] = await db
      .select()
      .from(scheduleItems)
      .where(
        and(eq(scheduleItems.studentId, studentId), eq(scheduleItems.familyDate, "2026-01-15")),
      )
      .limit(1);

    if (!item) {
      throw new Error("Expected today schedule item");
    }

    return { parentId, studentId, itemId: item.id };
  }

  it("completes pending item with fact and on_time kind (AC-M2-3/F3)", async () => {
    const { studentId, itemId } = await seedTodayItem();
    const settleSpy = vi.fn<SettleForFactFn>().mockResolvedValue(undefined);

    const result = await completeScheduleItem(db, {
      actorId: studentId,
      scheduleItemId: itemId,
      idempotencyKey: "complete-1",
      now: FIXED_NOW,
      settleForFact: settleSpy,
    });

    expect(result.idempotentReplay).toBe(false);
    expect(result.completionKind).toBe("on_time");

    const [item] = await db
      .select()
      .from(scheduleItems)
      .where(eq(scheduleItems.id, itemId))
      .limit(1);
    expect(item?.status).toBe("completed");

    const facts = await db
      .select()
      .from(factVersions)
      .where(eq(factVersions.scheduleItemId, itemId));
    expect(facts).toHaveLength(1);
    expect(settleSpy).toHaveBeenCalledOnce();
  });

  it("replays complete with same key (F11)", async () => {
    const { studentId, itemId } = await seedTodayItem();

    const first = await completeScheduleItem(db, {
      actorId: studentId,
      scheduleItemId: itemId,
      idempotencyKey: "complete-replay",
      now: FIXED_NOW,
    });

    const replay = await completeScheduleItem(db, {
      actorId: studentId,
      scheduleItemId: itemId,
      idempotencyKey: "complete-replay",
      now: FIXED_NOW,
    });

    expect(replay.idempotentReplay).toBe(true);
    expect(replay.eventId).toBe(first.eventId);
    expect(replay.factVersionId).toBe(first.factVersionId);

    const events = await db
      .select()
      .from(scheduleEvents)
      .where(eq(scheduleEvents.scheduleItemId, itemId));
    expect(events).toHaveLength(1);
  });

  it("rejects complete on already completed item with different key (F3)", async () => {
    const { studentId, itemId } = await seedTodayItem();

    await completeScheduleItem(db, {
      actorId: studentId,
      scheduleItemId: itemId,
      idempotencyKey: "complete-first",
      now: FIXED_NOW,
    });

    await expect(
      completeScheduleItem(db, {
        actorId: studentId,
        scheduleItemId: itemId,
        idempotencyKey: "complete-second",
        now: FIXED_NOW,
      }),
    ).rejects.toMatchObject({ code: "STATE_CONFLICT" });
  });

  it("rejects window expired complete after persist (F7)", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);

    const created = await createFormalPlan(db, {
      ownerId: parentId,
      studentId,
      idempotencyKey: "create-expired",
      body: { ...DEFAULT_PLAN_BODY, startDate: "2026-01-15" },
      now: FIXED_NOW,
    });

    await db.execute(`
      INSERT INTO schedule_items (
        plan_id, plan_version_id, student_id, owner_id, family_date, slot_key,
        scheduled_at, status, source, occurrence_key
      ) VALUES (
        '${created.planId}', '${created.versionId}', '${studentId}', '${parentId}',
        '2026-01-01', 'default', '2026-01-01T12:00:00Z', 'pending', 'plan', 'manual-expired-complete'
      )
    `);

    const [item] = await db
      .select()
      .from(scheduleItems)
      .where(eq(scheduleItems.occurrenceKey, "manual-expired-complete"))
      .limit(1);

    await expect(
      completeScheduleItem(db, {
        actorId: studentId,
        scheduleItemId: item!.id,
        idempotencyKey: "complete-expired",
        now: FIXED_NOW,
      }),
    ).rejects.toMatchObject({ code: "WINDOW_EXPIRED" satisfies ScheduleError["code"] });

    const [updated] = await db
      .select()
      .from(scheduleItems)
      .where(eq(scheduleItems.id, item!.id))
      .limit(1);
    expect(updated?.status).toBe("expired");
  });

  it("rejects cross-actor same key (F20)", async () => {
    const { parentId, studentId, itemId } = await seedTodayItem();

    await completeScheduleItem(db, {
      actorId: studentId,
      scheduleItemId: itemId,
      idempotencyKey: "complete-cross-actor",
      now: FIXED_NOW,
    });

    await expect(
      completeScheduleItem(db, {
        actorId: parentId,
        scheduleItemId: itemId,
        idempotencyKey: "complete-cross-actor",
        now: FIXED_NOW,
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("supports late completion within window (F15)", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);

    const created = await createFormalPlan(db, {
      ownerId: parentId,
      studentId,
      idempotencyKey: "create-late",
      body: { ...DEFAULT_PLAN_BODY, startDate: "2026-01-15" },
      now: FIXED_NOW,
    });

    await db.execute(`
      INSERT INTO schedule_items (
        plan_id, plan_version_id, student_id, owner_id, family_date, slot_key,
        scheduled_at, status, source, occurrence_key
      ) VALUES (
        '${created.planId}', '${created.versionId}', '${studentId}', '${parentId}',
        '2026-01-14', 'default', '2026-01-14T12:00:00Z', 'pending', 'plan', 'manual-late-complete'
      )
    `);

    const [item] = await db
      .select()
      .from(scheduleItems)
      .where(eq(scheduleItems.occurrenceKey, "manual-late-complete"))
      .limit(1);

    const lateNow = new Date("2026-01-15T08:00:00.000Z");

    const result = await completeScheduleItem(db, {
      actorId: studentId,
      scheduleItemId: item!.id,
      idempotencyKey: "complete-late",
      now: lateNow,
    });

    expect(result.completionKind).toBe("late");
  });

  it("does not write ledger in phase 3 (no settlement service)", async () => {
    const { studentId, itemId } = await seedTodayItem();

    await completeScheduleItem(db, {
      actorId: studentId,
      scheduleItemId: itemId,
      idempotencyKey: "complete-no-ledger",
      now: FIXED_NOW,
    });

    const ledger = await db.select().from(pointLedgerEntries);
    expect(ledger).toHaveLength(0);
  });
});
