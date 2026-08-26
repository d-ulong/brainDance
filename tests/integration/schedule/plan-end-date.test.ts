import { config } from "dotenv";
import { and, eq, gt } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { scheduleItems } from "@/db/schema";
import { createFormalPlan, editFormalPlan } from "@/modules/schedule/plan.service";
import { maintainHorizon } from "@/modules/schedule/maintain-horizon.service";
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

describe.skipIf(!hasDb)("plan end date", () => {
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

  it("shortens endDate cancelling pending after new end (R9/F22)", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);

    const created = await createFormalPlan(db, {
      ownerId: parentId,
      studentId,
      idempotencyKey: "create-shorten",
      body: { ...DEFAULT_PLAN_BODY, endDate: "2026-02-28" },
      now: FIXED_NOW,
    });

    await editFormalPlan(db, {
      ownerId: parentId,
      planId: created.planId,
      idempotencyKey: "edit-shorten",
      body: { endDate: "2026-01-20" },
      now: FIXED_NOW,
    });

    const cancelled = await db
      .select()
      .from(scheduleItems)
      .where(
        and(
          eq(scheduleItems.studentId, studentId),
          eq(scheduleItems.status, "cancelled"),
          gt(scheduleItems.familyDate, "2026-01-20"),
        ),
      );

    expect(cancelled.length).toBeGreaterThan(0);
  });

  it("extends endDate allowing generation to new horizon (R9/F22)", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);

    const created = await createFormalPlan(db, {
      ownerId: parentId,
      studentId,
      idempotencyKey: "create-extend",
      body: { ...DEFAULT_PLAN_BODY, endDate: "2026-01-20" },
      now: FIXED_NOW,
    });

    const beforeCount = (
      await db.select().from(scheduleItems).where(eq(scheduleItems.studentId, studentId))
    ).length;

    await editFormalPlan(db, {
      ownerId: parentId,
      planId: created.planId,
      idempotencyKey: "edit-extend",
      body: { endDate: "2026-02-10" },
      now: FIXED_NOW,
    });

    const afterCount = (
      await db.select().from(scheduleItems).where(eq(scheduleItems.studentId, studentId))
    ).length;

    expect(afterCount).toBeGreaterThan(beforeCount);

    const beyondOldEnd = await db
      .select()
      .from(scheduleItems)
      .where(
        and(
          eq(scheduleItems.studentId, studentId),
          gt(scheduleItems.familyDate, "2026-01-20"),
          eq(scheduleItems.status, "pending"),
        ),
      );

    expect(beyondOldEnd.length).toBeGreaterThan(0);
  });

  it("unchanged endDate keeps same boundary semantics (R9/F22)", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);

    const created = await createFormalPlan(db, {
      ownerId: parentId,
      studentId,
      idempotencyKey: "create-unchanged",
      body: { ...DEFAULT_PLAN_BODY, endDate: "2026-01-25" },
      now: FIXED_NOW,
    });

    await editFormalPlan(db, {
      ownerId: parentId,
      planId: created.planId,
      idempotencyKey: "edit-unchanged",
      body: { title: "Renamed only" },
      now: FIXED_NOW,
    });

    const beyondEnd = await db
      .select()
      .from(scheduleItems)
      .where(
        and(eq(scheduleItems.studentId, studentId), gt(scheduleItems.familyDate, "2026-01-25")),
      );

    expect(beyondEnd).toHaveLength(0);
  });

  it("maintain no-op from>through still persists expired (F28)", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);

    await createFormalPlan(db, {
      ownerId: parentId,
      studentId,
      idempotencyKey: "create-ended",
      body: { ...DEFAULT_PLAN_BODY, endDate: "2026-01-01" },
      now: FIXED_NOW,
    });

    const pastItem = await db.execute(`
      INSERT INTO schedule_items (
        plan_id, plan_version_id, student_id, owner_id, family_date, slot_key,
        scheduled_at, status, source, occurrence_key
      )
      SELECT p.id, p.current_version, p.student_id, p.owner_id, '2026-01-01', 'default',
        '2026-01-01T12:00:00Z'::timestamptz, 'pending', 'plan', 'manual-past-item'
      FROM plans p WHERE p.student_id = '${studentId}'::uuid
      RETURNING id
    `);

    expect(pastItem.length).toBe(1);

    const result = await maintainHorizon(db, {
      actorId: parentId,
      studentId,
      idempotencyKey: "maintain-noop",
      now: FIXED_NOW,
    });

    expect(result.itemsCreated).toBe(0);

    const [item] = await db
      .select()
      .from(scheduleItems)
      .where(eq(scheduleItems.occurrenceKey, "manual-past-item"))
      .limit(1);

    expect(item?.status).toBe("expired");
  });

  it("maintain replay does not persist expired again (F28)", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);

    await createFormalPlan(db, {
      ownerId: parentId,
      studentId,
      idempotencyKey: "create-replay-persist",
      body: DEFAULT_PLAN_BODY,
      now: FIXED_NOW,
    });

    const first = await maintainHorizon(db, {
      actorId: parentId,
      studentId,
      idempotencyKey: "maintain-replay-persist",
      now: FIXED_NOW,
    });

    const expiredCountBefore = (
      await db
        .select()
        .from(scheduleItems)
        .where(and(eq(scheduleItems.studentId, studentId), eq(scheduleItems.status, "expired")))
    ).length;

    const replay = await maintainHorizon(db, {
      actorId: parentId,
      studentId,
      idempotencyKey: "maintain-replay-persist",
      now: FIXED_NOW,
    });

    expect(replay.idempotentReplay).toBe(true);
    expect(replay.maintainId).toBe(first.maintainId);

    const expiredCountAfter = (
      await db
        .select()
        .from(scheduleItems)
        .where(and(eq(scheduleItems.studentId, studentId), eq(scheduleItems.status, "expired")))
    ).length;

    expect(expiredCountAfter).toBe(expiredCountBefore);
  });

  it("persistExpiredPastWindow uses completion window not simple date compare", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);

    const created = await createFormalPlan(db, {
      ownerId: parentId,
      studentId,
      idempotencyKey: "create-persist",
      body: DEFAULT_PLAN_BODY,
      now: FIXED_NOW,
    });

    const yesterday = "2026-01-14";
    await db.execute(`
      INSERT INTO schedule_items (
        plan_id, plan_version_id, student_id, owner_id, family_date, slot_key,
        scheduled_at, status, source, occurrence_key
      ) VALUES (
        '${created.planId}', '${created.versionId}', '${studentId}', '${parentId}',
        '${yesterday}', 'default', '2026-01-14T12:00:00Z', 'pending', 'plan', 'manual-yesterday'
      )
    `);

    await persistExpiredPastWindow(db, studentId, FIXED_NOW);

    const [item] = await db
      .select()
      .from(scheduleItems)
      .where(eq(scheduleItems.occurrenceKey, "manual-yesterday"))
      .limit(1);

    expect(item?.status).toBe("pending");
  });
});
