import { config } from "dotenv";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { scheduleItems } from "@/db/schema";
import { completeScheduleItem } from "@/modules/schedule/complete-schedule.service";
import { skipScheduleItem } from "@/modules/schedule/skip-schedule.service";
import { createFormalPlan } from "@/modules/schedule/plan.service";
import { persistExpiredPastWindow } from "@/modules/schedule/persist-expired.service";
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

  it("does not overwrite item completed during persist window (P3-R03 race)", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);

    const created = await createFormalPlan(db, {
      ownerId: parentId,
      studentId,
      idempotencyKey: "persist-race",
      body: { ...DEFAULT_PLAN_BODY, startDate: "2026-01-15" },
      now: FIXED_NOW,
    });

    await db.execute(`
      INSERT INTO schedule_items (
        plan_id, plan_version_id, student_id, owner_id, family_date, slot_key,
        scheduled_at, status, source, occurrence_key
      ) VALUES (
        '${created.planId}', '${created.versionId}', '${studentId}', '${parentId}',
        '2026-01-14', 'default', '2026-01-14T12:00:00Z', 'pending', 'plan', 'persist-race-late'
      )
    `);

    const [lateItem] = await db
      .select()
      .from(scheduleItems)
      .where(eq(scheduleItems.occurrenceKey, "persist-race-late"))
      .limit(1);

    const lateNow = new Date("2026-01-15T08:00:00.000Z");
    await completeScheduleItem(db, {
      actorId: studentId,
      scheduleItemId: lateItem!.id,
      idempotencyKey: "persist-race-complete",
      now: lateNow,
    });

    await persistExpiredPastWindow(db, studentId, FIXED_NOW);

    const [updated] = await db
      .select()
      .from(scheduleItems)
      .where(eq(scheduleItems.occurrenceKey, "persist-race-late"))
      .limit(1);
    expect(updated?.status).toBe("completed");
  });

  it("expires eligible pending without touching skip terminal status (P3-R03)", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);

    const created = await createFormalPlan(db, {
      ownerId: parentId,
      studentId,
      idempotencyKey: "persist-skip-terminal",
      body: { ...DEFAULT_PLAN_BODY, startDate: "2026-01-15" },
      now: FIXED_NOW,
    });

    await db.execute(`
      INSERT INTO schedule_items (
        plan_id, plan_version_id, student_id, owner_id, family_date, slot_key,
        scheduled_at, status, source, occurrence_key
      ) VALUES (
        '${created.planId}', '${created.versionId}', '${studentId}', '${parentId}',
        '2026-01-01', 'default', '2026-01-01T12:00:00Z', 'pending', 'plan', 'persist-skip-pending'
      )
    `);

    const [todayItem] = await db
      .select()
      .from(scheduleItems)
      .where(
        and(eq(scheduleItems.studentId, studentId), eq(scheduleItems.familyDate, "2026-01-15")),
      )
      .limit(1);

    await skipScheduleItem(db, {
      actorId: studentId,
      scheduleItemId: todayItem!.id,
      idempotencyKey: "persist-skip-today",
      now: FIXED_NOW,
    });

    await persistExpiredPastWindow(db, studentId, FIXED_NOW);

    const [skippedToday] = await db
      .select()
      .from(scheduleItems)
      .where(eq(scheduleItems.id, todayItem!.id))
      .limit(1);
    expect(skippedToday?.status).toBe("skipped");

    const [expiredPending] = await db
      .select()
      .from(scheduleItems)
      .where(eq(scheduleItems.occurrenceKey, "persist-skip-pending"))
      .limit(1);
    expect(expiredPending?.status).toBe("expired");
  });
});
