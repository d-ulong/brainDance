import { config } from "dotenv";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { factVersions, scheduleEvents } from "@/db/schema";
import { completeScheduleItem } from "@/modules/schedule/complete-schedule.service";
import { skipScheduleItem } from "@/modules/schedule/skip-schedule.service";
import { createFormalPlan } from "@/modules/schedule/plan.service";
import { ScheduleError } from "@/modules/schedule/errors";
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

describe.skipIf(!hasDb)("schedule terminal concurrency", () => {
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

  async function seedItem() {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);

    await createFormalPlan(db, {
      ownerId: parentId,
      studentId,
      idempotencyKey: `create-concurrency-${crypto.randomUUID()}`,
      body: { ...DEFAULT_PLAN_BODY, startDate: "2026-01-15" },
      now: FIXED_NOW,
    });

    const items = await db.execute(`
      SELECT id FROM schedule_items
      WHERE student_id = '${studentId}'::uuid AND family_date = '2026-01-15'
      LIMIT 1
    `);

    await enableSchedulePointRule(db, { parentId, studentId });

    return { studentId, itemId: (items[0] as { id: string }).id };
  }

  it("concurrent complete same key yields one event and replay (F24)", async () => {
    const { studentId, itemId } = await seedItem();

    const results = await Promise.allSettled([
      completeScheduleItem(db, {
        actorId: studentId,
        scheduleItemId: itemId,
        idempotencyKey: "concurrent-complete",
        now: FIXED_NOW,
      }),
      completeScheduleItem(db, {
        actorId: studentId,
        scheduleItemId: itemId,
        idempotencyKey: "concurrent-complete",
        now: FIXED_NOW,
      }),
    ]);

    const fulfilled = results.filter(
      (result) => result.status === "fulfilled",
    ) as PromiseFulfilledResult<Awaited<ReturnType<typeof completeScheduleItem>>>[];

    expect(fulfilled.length).toBe(2);

    const events = await db
      .select()
      .from(scheduleEvents)
      .where(and(eq(scheduleEvents.scheduleItemId, itemId)));

    expect(events).toHaveLength(1);

    const facts = await db
      .select()
      .from(factVersions)
      .where(eq(factVersions.scheduleItemId, itemId));
    expect(facts).toHaveLength(1);

    expect(fulfilled.some((result) => result.value.idempotentReplay)).toBe(true);
  });

  it("concurrent skip same key yields one event (F24)", async () => {
    const { studentId, itemId } = await seedItem();

    await Promise.all([
      skipScheduleItem(db, {
        actorId: studentId,
        scheduleItemId: itemId,
        idempotencyKey: "concurrent-skip",
        now: FIXED_NOW,
      }),
      skipScheduleItem(db, {
        actorId: studentId,
        scheduleItemId: itemId,
        idempotencyKey: "concurrent-skip",
        now: FIXED_NOW,
      }),
    ]);

    const events = await db
      .select()
      .from(scheduleEvents)
      .where(eq(scheduleEvents.scheduleItemId, itemId));

    expect(events).toHaveLength(1);
  });

  it("complete vs skip same key conflicts (F24/F16)", async () => {
    const { studentId, itemId } = await seedItem();

    const results = await Promise.allSettled([
      completeScheduleItem(db, {
        actorId: studentId,
        scheduleItemId: itemId,
        idempotencyKey: "complete-skip-race",
        now: FIXED_NOW,
      }),
      skipScheduleItem(db, {
        actorId: studentId,
        scheduleItemId: itemId,
        idempotencyKey: "complete-skip-race",
        now: FIXED_NOW,
      }),
    ]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter(
      (result) => result.status === "rejected",
    ) as PromiseRejectedResult[];

    expect(fulfilled.length + rejected.length).toBe(2);
    expect(fulfilled.length).toBe(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0]!.reason as ScheduleError).code).toBe("IDEMPOTENCY_CONFLICT");

    const events = await db
      .select()
      .from(scheduleEvents)
      .where(eq(scheduleEvents.scheduleItemId, itemId));

    expect(events).toHaveLength(1);
  });
});
