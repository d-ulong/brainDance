import { config } from "dotenv";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createFormalPlan } from "@/modules/schedule/plan.service";
import { completeScheduleItem } from "@/modules/schedule/complete-schedule.service";
import { skipScheduleItem } from "@/modules/schedule/skip-schedule.service";
import { maintainHorizon } from "@/modules/schedule/maintain-horizon.service";
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

describe.skipIf(!hasDb)("schedule auth", () => {
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

  it("rejects create without relationship (F1)", async () => {
    const { parentId } = await bootstrapParentStudentRelationship(db);
    const other = await bootstrapParentStudentRelationship(db);

    await expect(
      createFormalPlan(db, {
        ownerId: parentId,
        studentId: other.studentId,
        idempotencyKey: "create-forbidden",
        body: DEFAULT_PLAN_BODY,
        now: FIXED_NOW,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects complete by non-student (F1)", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);

    const created = await createFormalPlan(db, {
      ownerId: parentId,
      studentId,
      idempotencyKey: "create-auth-complete",
      body: { ...DEFAULT_PLAN_BODY, startDate: "2026-01-15" },
      now: FIXED_NOW,
    });

    const items = await db.execute(`
      SELECT id FROM schedule_items WHERE plan_id = '${created.planId}'::uuid LIMIT 1
    `);
    const itemId = (items[0] as { id: string }).id;

    await expect(
      completeScheduleItem(db, {
        actorId: parentId,
        scheduleItemId: itemId,
        idempotencyKey: "complete-forbidden",
        now: FIXED_NOW,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects skip by unrelated parent (F1)", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);
    const other = await bootstrapParentStudentRelationship(db);

    const created = await createFormalPlan(db, {
      ownerId: parentId,
      studentId,
      idempotencyKey: "create-auth-skip",
      body: { ...DEFAULT_PLAN_BODY, startDate: "2026-01-15" },
      now: FIXED_NOW,
    });

    const items = await db.execute(`
      SELECT id FROM schedule_items WHERE plan_id = '${created.planId}'::uuid LIMIT 1
    `);
    const itemId = (items[0] as { id: string }).id;

    await expect(
      skipScheduleItem(db, {
        actorId: other.parentId,
        scheduleItemId: itemId,
        idempotencyKey: "skip-forbidden",
        now: FIXED_NOW,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects maintain by parent without relationship (F1)", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);
    const other = await bootstrapParentStudentRelationship(db);

    await createFormalPlan(db, {
      ownerId: parentId,
      studentId,
      idempotencyKey: "create-auth-maintain",
      body: DEFAULT_PLAN_BODY,
      now: FIXED_NOW,
    });

    await expect(
      maintainHorizon(db, {
        actorId: other.parentId,
        studentId,
        idempotencyKey: "maintain-forbidden",
        now: FIXED_NOW,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects complete by non-student even when idempotency key already used (P3-R05)", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);

    const created = await createFormalPlan(db, {
      ownerId: parentId,
      studentId,
      idempotencyKey: "create-auth-complete-key",
      body: { ...DEFAULT_PLAN_BODY, startDate: "2026-01-15" },
      now: FIXED_NOW,
    });

    const items = await db.execute(`
      SELECT id FROM schedule_items WHERE plan_id = '${created.planId}'::uuid LIMIT 1
    `);
    const itemId = (items[0] as { id: string }).id;

    await completeScheduleItem(db, {
      actorId: studentId,
      scheduleItemId: itemId,
      idempotencyKey: "shared-complete-key",
      now: FIXED_NOW,
    });

    await expect(
      completeScheduleItem(db, {
        actorId: parentId,
        scheduleItemId: itemId,
        idempotencyKey: "shared-complete-key",
        now: FIXED_NOW,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" satisfies ScheduleError["code"] });

    await expect(
      completeScheduleItem(db, {
        actorId: parentId,
        scheduleItemId: itemId,
        idempotencyKey: "shared-complete-key",
        body: { unexpected: true },
        now: FIXED_NOW,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" satisfies ScheduleError["code"] });
  });

  it("rejects skip by unrelated parent even when idempotency key already used (P3-R05)", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);
    const other = await bootstrapParentStudentRelationship(db);

    const created = await createFormalPlan(db, {
      ownerId: parentId,
      studentId,
      idempotencyKey: "create-auth-skip-key",
      body: { ...DEFAULT_PLAN_BODY, startDate: "2026-01-15" },
      now: FIXED_NOW,
    });

    const items = await db.execute(`
      SELECT id FROM schedule_items WHERE plan_id = '${created.planId}'::uuid LIMIT 1
    `);
    const itemId = (items[0] as { id: string }).id;

    await skipScheduleItem(db, {
      actorId: studentId,
      scheduleItemId: itemId,
      idempotencyKey: "shared-skip-key",
      body: { reason: "done" },
      now: FIXED_NOW,
    });

    await expect(
      skipScheduleItem(db, {
        actorId: other.parentId,
        scheduleItemId: itemId,
        idempotencyKey: "shared-skip-key",
        body: { reason: "done" },
        now: FIXED_NOW,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" satisfies ScheduleError["code"] });

    await expect(
      skipScheduleItem(db, {
        actorId: other.parentId,
        scheduleItemId: itemId,
        idempotencyKey: "shared-skip-key",
        body: { reason: "different" },
        now: FIXED_NOW,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" satisfies ScheduleError["code"] });
  });
});
