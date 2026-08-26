import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { planScheduleSlots, scheduleItems } from "@/db/schema";
import { toScheduledAt } from "@/modules/time-policy/to-scheduled-at";
import { createFormalPlan } from "@/modules/schedule/plan.service";
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

describe.skipIf(!hasDb)("schedule generation", () => {
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

  it("create path uses v1 slot for occurrence_key and scheduled_at (R5/R6/R10)", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);

    const result = await createFormalPlan(db, {
      ownerId: parentId,
      studentId,
      idempotencyKey: "create-generation",
      body: { ...DEFAULT_PLAN_BODY, localTime: "20:00", startDate: "2026-01-15" },
      now: FIXED_NOW,
    });

    const [slot] = await db
      .select()
      .from(planScheduleSlots)
      .where(eq(planScheduleSlots.planVersionId, result.versionId))
      .limit(1);

    expect(slot?.localTime).toBe("20:00:00");

    const items = await db
      .select()
      .from(scheduleItems)
      .where(eq(scheduleItems.planVersionId, result.versionId));

    expect(items.length).toBeGreaterThan(0);
    expect(items.every((item) => item.planId === result.planId)).toBe(true);
    expect(items.every((item) => item.studentId === studentId)).toBe(true);
    expect(items.every((item) => item.ownerId === parentId)).toBe(true);
    expect(items.every((item) => item.slotKey === "default")).toBe(true);
    expect(items.every((item) => item.source === "plan")).toBe(true);
    expect(items.every((item) => item.planSnapshot === null)).toBe(true);
    expect(items.every((item) => item.occurrenceKey.includes(":daily:20:00"))).toBe(true);

    const sample = items[0]!;
    expect(sample.scheduledAt).toEqual(toScheduledAt(sample.familyDate, "20:00:00"));
  });

  it("does not write schedule_horizon_maintains on inline create", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);

    await createFormalPlan(db, {
      ownerId: parentId,
      studentId,
      idempotencyKey: "create-no-maintain-row",
      body: DEFAULT_PLAN_BODY,
      now: FIXED_NOW,
    });

    const maintains = await db.execute(
      `SELECT count(*)::int AS count FROM schedule_horizon_maintains`,
    );
    expect((maintains[0] as { count: number }).count).toBe(0);
  });

  it("respects plan end_date upper bound", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);

    await createFormalPlan(db, {
      ownerId: parentId,
      studentId,
      idempotencyKey: "create-end-bound",
      body: { ...DEFAULT_PLAN_BODY, endDate: "2026-01-20" },
      now: FIXED_NOW,
    });

    const items = await db
      .select()
      .from(scheduleItems)
      .where(eq(scheduleItems.studentId, studentId));

    expect(items.every((item) => item.familyDate <= "2026-01-20")).toBe(true);
    expect(items.some((item) => item.familyDate === "2026-01-20")).toBe(true);
  });
});
