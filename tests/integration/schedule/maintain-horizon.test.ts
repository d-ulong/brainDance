import { config } from "dotenv";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { outboxEvents, scheduleHorizonMaintains, scheduleItems } from "@/db/schema";
import { createFormalPlan } from "@/modules/schedule/plan.service";
import { maintainHorizon } from "@/modules/schedule/maintain-horizon.service";
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

describe.skipIf(!hasDb)("maintain horizon", () => {
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

  it("generates items using current version slot (R6/R5)", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);

    await createFormalPlan(db, {
      ownerId: parentId,
      studentId,
      idempotencyKey: "create-maintain",
      body: DEFAULT_PLAN_BODY,
      now: FIXED_NOW,
    });

    const before = await db
      .select()
      .from(scheduleItems)
      .where(eq(scheduleItems.studentId, studentId));

    const result = await maintainHorizon(db, {
      actorId: parentId,
      studentId,
      idempotencyKey: "maintain-1",
      now: FIXED_NOW,
    });

    expect(result.idempotentReplay).toBe(false);

    const after = await db
      .select()
      .from(scheduleItems)
      .where(eq(scheduleItems.studentId, studentId));
    expect(after.length).toBeGreaterThanOrEqual(before.length);
    expect(after.every((item) => item.ownerId === parentId)).toBe(true);
    expect(after.every((item) => item.slotKey === "default")).toBe(true);
    expect(after.every((item) => item.source === "plan")).toBe(true);
    expect(after.every((item) => item.occurrenceKey.includes(":daily:20:00"))).toBe(true);
  });

  it("replays maintain without generate audit or outbox (F14/C11)", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);

    await createFormalPlan(db, {
      ownerId: parentId,
      studentId,
      idempotencyKey: "create-maintain-replay",
      body: DEFAULT_PLAN_BODY,
      now: FIXED_NOW,
    });

    const first = await maintainHorizon(db, {
      actorId: parentId,
      studentId,
      idempotencyKey: "maintain-replay",
      now: FIXED_NOW,
    });

    const outboxBefore = await db.select().from(outboxEvents);

    const replay = await maintainHorizon(db, {
      actorId: parentId,
      studentId,
      idempotencyKey: "maintain-replay",
      now: FIXED_NOW,
    });

    expect(replay.idempotentReplay).toBe(true);
    expect(replay.maintainId).toBe(first.maintainId);

    const outboxAfter = await db.select().from(outboxEvents);
    expect(outboxAfter.length).toBe(outboxBefore.length);
  });

  it("no-op maintain still writes maintain row with items_created=0 (F28)", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);

    await createFormalPlan(db, {
      ownerId: parentId,
      studentId,
      idempotencyKey: "create-maintain-noop",
      body: { ...DEFAULT_PLAN_BODY, endDate: "2026-01-10" },
      now: FIXED_NOW,
    });

    const result = await maintainHorizon(db, {
      actorId: parentId,
      studentId,
      idempotencyKey: "maintain-noop-row",
      now: FIXED_NOW,
    });

    expect(result.itemsCreated).toBe(0);

    const [row] = await db
      .select()
      .from(scheduleHorizonMaintains)
      .where(eq(scheduleHorizonMaintains.id, result.maintainId))
      .limit(1);

    expect(row?.itemsCreated).toBe(0);
  });

  it("concurrent same key only one outbox horizon_maintained (F26/C10)", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);

    await createFormalPlan(db, {
      ownerId: parentId,
      studentId,
      idempotencyKey: "create-concurrent",
      body: DEFAULT_PLAN_BODY,
      now: FIXED_NOW,
    });

    const results = await Promise.allSettled([
      maintainHorizon(db, {
        actorId: parentId,
        studentId,
        idempotencyKey: "maintain-concurrent",
        now: FIXED_NOW,
      }),
      maintainHorizon(db, {
        actorId: parentId,
        studentId,
        idempotencyKey: "maintain-concurrent",
        now: FIXED_NOW,
      }),
    ]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    expect(fulfilled.length).toBe(2);

    const maintains = await db
      .select()
      .from(scheduleHorizonMaintains)
      .where(
        and(
          eq(scheduleHorizonMaintains.studentId, studentId),
          eq(scheduleHorizonMaintains.idempotencyKey, "maintain-concurrent"),
        ),
      );

    expect(maintains).toHaveLength(1);

    const horizonOutbox = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.eventType, "schedule.horizon_maintained"));

    expect(horizonOutbox.length).toBeLessThanOrEqual(1);
  });
});
