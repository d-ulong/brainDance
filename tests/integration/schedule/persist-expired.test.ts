import { config } from "dotenv";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { factVersions, scheduleEvents, scheduleItems } from "@/db/schema";
import { completeScheduleItem } from "@/modules/schedule/complete-schedule.service";
import { skipScheduleItem } from "@/modules/schedule/skip-schedule.service";
import { createFormalPlan } from "@/modules/schedule/plan.service";
import { persistExpiredPastWindow } from "@/modules/schedule/persist-expired.service";
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

/** Deterministic barrier: `opened` resolves when the gate opens; `released` resolves when release() is called. */
function createGate<T>() {
  let open!: (value: T) => void;
  let release!: () => void;
  const opened = new Promise<T>((resolve) => {
    open = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { opened, released, open, release };
}

describe.skipIf(!hasDb)("persist expired past window", () => {
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

  it("does not overwrite completed or skipped terminal statuses (P3-R03)", async () => {
    const pairA = await bootstrapParentStudentRelationship(db);
    const pairB = await bootstrapParentStudentRelationship(db);

    const createdA = await createFormalPlan(db, {
      ownerId: pairA.parentId,
      studentId: pairA.studentId,
      idempotencyKey: "persist-student-a",
      body: { ...DEFAULT_PLAN_BODY, startDate: "2026-01-15" },
      now: FIXED_NOW,
    });

    await createFormalPlan(db, {
      ownerId: pairB.parentId,
      studentId: pairB.studentId,
      idempotencyKey: "persist-student-b",
      body: { ...DEFAULT_PLAN_BODY, startDate: "2026-01-15" },
      now: FIXED_NOW,
    });

    await db.execute(`
      INSERT INTO schedule_items (
        plan_id, plan_version_id, student_id, owner_id, family_date, slot_key,
        scheduled_at, status, source, occurrence_key
      ) VALUES (
        '${createdA.planId}', '${createdA.versionId}', '${pairA.studentId}', '${pairA.parentId}',
        '2026-01-01', 'default', '2026-01-01T12:00:00Z', 'pending', 'plan', 'persist-pending-expire'
      )
    `);

    await db.execute(`
      INSERT INTO schedule_items (
        plan_id, plan_version_id, student_id, owner_id, family_date, slot_key,
        scheduled_at, status, source, occurrence_key
      ) VALUES (
        '${createdA.planId}', '${createdA.versionId}', '${pairA.studentId}', '${pairA.parentId}',
        '2026-01-02', 'default', '2026-01-02T12:00:00Z', 'completed', 'plan', 'persist-completed'
      )
    `);

    await db.execute(`
      INSERT INTO schedule_items (
        plan_id, plan_version_id, student_id, owner_id, family_date, slot_key,
        scheduled_at, status, source, occurrence_key
      ) VALUES (
        '${createdA.planId}', '${createdA.versionId}', '${pairA.studentId}', '${pairA.parentId}',
        '2026-01-03', 'default', '2026-01-03T12:00:00Z', 'skipped', 'plan', 'persist-skipped'
      )
    `);

    const [todayItem] = await db
      .select()
      .from(scheduleItems)
      .where(
        and(
          eq(scheduleItems.studentId, pairA.studentId),
          eq(scheduleItems.familyDate, "2026-01-15"),
        ),
      )
      .limit(1);

    await enableSchedulePointRule(db, {
      parentId: pairA.parentId,
      studentId: pairA.studentId,
    });

    await completeScheduleItem(db, {
      actorId: pairA.studentId,
      scheduleItemId: todayItem!.id,
      idempotencyKey: "persist-complete-today",
      now: FIXED_NOW,
    });

    await persistExpiredPastWindow(db, pairA.studentId, FIXED_NOW);

    const [pendingExpired] = await db
      .select()
      .from(scheduleItems)
      .where(eq(scheduleItems.occurrenceKey, "persist-pending-expire"))
      .limit(1);
    expect(pendingExpired?.status).toBe("expired");

    const [completedItem] = await db
      .select()
      .from(scheduleItems)
      .where(eq(scheduleItems.occurrenceKey, "persist-completed"))
      .limit(1);
    expect(completedItem?.status).toBe("completed");

    const [skippedItem] = await db
      .select()
      .from(scheduleItems)
      .where(eq(scheduleItems.occurrenceKey, "persist-skipped"))
      .limit(1);
    expect(skippedItem?.status).toBe("skipped");

    const [todayCompleted] = await db
      .select()
      .from(scheduleItems)
      .where(eq(scheduleItems.id, todayItem!.id))
      .limit(1);
    expect(todayCompleted?.status).toBe("completed");

    const otherStudentPending = await db
      .select()
      .from(scheduleItems)
      .where(
        and(eq(scheduleItems.studentId, pairB.studentId), eq(scheduleItems.status, "pending")),
      );
    expect(otherStudentPending.length).toBeGreaterThan(0);
    expect(otherStudentPending.every((item) => item.status === "pending")).toBe(true);
  });

  it("does not overwrite item completed during persist SELECT→UPDATE race (P3-R2-01)", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);

    const created = await createFormalPlan(db, {
      ownerId: parentId,
      studentId,
      idempotencyKey: "persist-race-complete",
      body: { ...DEFAULT_PLAN_BODY, startDate: "2026-01-15" },
      now: FIXED_NOW,
    });

    await db.execute(`
      INSERT INTO schedule_items (
        plan_id, plan_version_id, student_id, owner_id, family_date, slot_key,
        scheduled_at, status, source, occurrence_key
      ) VALUES (
        '${created.planId}', '${created.versionId}', '${studentId}', '${parentId}',
        '2026-01-13', 'default', '2026-01-13T12:00:00Z', 'pending', 'plan', 'persist-race-complete'
      )
    `);

    const [raceItem] = await db
      .select()
      .from(scheduleItems)
      .where(eq(scheduleItems.occurrenceKey, "persist-race-complete"))
      .limit(1);

    const selectGate = createGate<string[]>();
    const resumeGate = createGate<void>();

    const persistPromise = db.transaction(async (tx) =>
      persistExpiredPastWindow(tx, studentId, FIXED_NOW, {
        testHooks: {
          afterSelectCandidates: async (expiredIds) => {
            selectGate.open(expiredIds);
            await resumeGate.released;
          },
        },
      }),
    );

    const selectedIds = await selectGate.opened;
    expect(selectedIds).toContain(raceItem!.id);

    await enableSchedulePointRule(db, { parentId, studentId });

    const withinWindowNow = new Date("2026-01-14T08:00:00.000Z");
    await completeScheduleItem(db, {
      actorId: studentId,
      scheduleItemId: raceItem!.id,
      idempotencyKey: "persist-race-complete-cmd",
      now: withinWindowNow,
    });

    resumeGate.release();
    await persistPromise;

    const [updated] = await db
      .select()
      .from(scheduleItems)
      .where(eq(scheduleItems.id, raceItem!.id))
      .limit(1);
    expect(updated?.status).toBe("completed");

    const events = await db
      .select()
      .from(scheduleEvents)
      .where(eq(scheduleEvents.scheduleItemId, raceItem!.id));
    expect(events).toHaveLength(1);

    const facts = await db
      .select()
      .from(factVersions)
      .where(eq(factVersions.scheduleItemId, raceItem!.id));
    expect(facts).toHaveLength(1);
  });

  it("does not overwrite item skipped during persist SELECT→UPDATE race (P3-R2-01)", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);

    const created = await createFormalPlan(db, {
      ownerId: parentId,
      studentId,
      idempotencyKey: "persist-race-skip",
      body: { ...DEFAULT_PLAN_BODY, startDate: "2026-01-15" },
      now: FIXED_NOW,
    });

    await db.execute(`
      INSERT INTO schedule_items (
        plan_id, plan_version_id, student_id, owner_id, family_date, slot_key,
        scheduled_at, status, source, occurrence_key
      ) VALUES (
        '${created.planId}', '${created.versionId}', '${studentId}', '${parentId}',
        '2026-01-13', 'default', '2026-01-13T12:00:00Z', 'pending', 'plan', 'persist-race-skip'
      )
    `);

    const [raceItem] = await db
      .select()
      .from(scheduleItems)
      .where(eq(scheduleItems.occurrenceKey, "persist-race-skip"))
      .limit(1);

    const selectGate = createGate<string[]>();
    const resumeGate = createGate<void>();

    const persistPromise = db.transaction(async (tx) =>
      persistExpiredPastWindow(tx, studentId, FIXED_NOW, {
        testHooks: {
          afterSelectCandidates: async (expiredIds) => {
            selectGate.open(expiredIds);
            await resumeGate.released;
          },
        },
      }),
    );

    const selectedIds = await selectGate.opened;
    expect(selectedIds).toContain(raceItem!.id);

    const withinWindowNow = new Date("2026-01-14T08:00:00.000Z");
    await skipScheduleItem(db, {
      actorId: studentId,
      scheduleItemId: raceItem!.id,
      idempotencyKey: "persist-race-skip-cmd",
      now: withinWindowNow,
    });

    resumeGate.release();
    await persistPromise;

    const [updated] = await db
      .select()
      .from(scheduleItems)
      .where(eq(scheduleItems.id, raceItem!.id))
      .limit(1);
    expect(updated?.status).toBe("skipped");

    const events = await db
      .select()
      .from(scheduleEvents)
      .where(eq(scheduleEvents.scheduleItemId, raceItem!.id));
    expect(events).toHaveLength(1);
  });
});
