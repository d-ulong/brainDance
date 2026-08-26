import { config } from "dotenv";
import { and, eq, gt } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  auditEvents,
  outboxEvents,
  plans,
  scheduleHorizonMaintains,
  scheduleItems,
} from "@/db/schema";
import { findOutboxEventByDedupeKey } from "@/modules/outbox/append-outbox-event";
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

  async function seedPlanWithHorizonGap(parentId: string, studentId: string) {
    const created = await createFormalPlan(db, {
      ownerId: parentId,
      studentId,
      idempotencyKey: `create-gap-${crypto.randomUUID()}`,
      body: DEFAULT_PLAN_BODY,
      now: FIXED_NOW,
    });

    const [plan] = await db.select().from(plans).where(eq(plans.id, created.planId)).limit(1);
    const currentVersionId = plan!.currentVersion!;

    await db
      .delete(scheduleItems)
      .where(
        and(
          eq(scheduleItems.studentId, studentId),
          eq(scheduleItems.planVersionId, currentVersionId),
          gt(scheduleItems.familyDate, "2026-01-20"),
        ),
      );

    const beforeItems = await db
      .select()
      .from(scheduleItems)
      .where(
        and(
          eq(scheduleItems.studentId, studentId),
          eq(scheduleItems.planVersionId, currentVersionId),
        ),
      );

    const maxPendingDate = beforeItems
      .filter((item) => item.status === "pending")
      .map((item) => item.familyDate)
      .sort()
      .at(-1);

    expect(maxPendingDate).toBe("2026-01-20");

    return { created, currentVersionId, countBefore: beforeItems.length };
  }

  it("fills controlled horizon gap with accurate items_created and outbox (P3-R04)", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);
    const { countBefore } = await seedPlanWithHorizonGap(parentId, studentId);

    const result = await maintainHorizon(db, {
      actorId: parentId,
      studentId,
      idempotencyKey: "maintain-gap-fill",
      now: FIXED_NOW,
    });

    expect(result.idempotentReplay).toBe(false);
    expect(result.itemsCreated).toBeGreaterThan(0);

    const afterItems = await db
      .select()
      .from(scheduleItems)
      .where(eq(scheduleItems.studentId, studentId));

    expect(afterItems.length).toBe(countBefore + result.itemsCreated);
    expect(afterItems.some((item) => item.familyDate === "2026-01-21")).toBe(true);
    expect(afterItems.every((item) => item.occurrenceKey.includes(":daily:20:00"))).toBe(true);

    const [maintainRow] = await db
      .select()
      .from(scheduleHorizonMaintains)
      .where(eq(scheduleHorizonMaintains.id, result.maintainId))
      .limit(1);
    expect(maintainRow?.itemsCreated).toBe(result.itemsCreated);

    const horizonOutbox = await findOutboxEventByDedupeKey(
      db,
      `schedule.horizon_maintained:${result.maintainId}`,
    );
    expect(horizonOutbox?.eventType).toBe("schedule.horizon_maintained");

    const horizonAudits = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "schedule.horizon_maintained"));
    expect(horizonAudits).toHaveLength(1);
  });

  it("replays maintain without generate audit or outbox (F14/C11)", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);
    await seedPlanWithHorizonGap(parentId, studentId);

    const first = await maintainHorizon(db, {
      actorId: parentId,
      studentId,
      idempotencyKey: "maintain-replay",
      now: FIXED_NOW,
    });

    expect(first.itemsCreated).toBeGreaterThan(0);

    const outboxBefore = await db.select().from(outboxEvents);
    const auditBefore = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "schedule.horizon_maintained"));

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

    const auditAfter = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "schedule.horizon_maintained"));
    expect(auditAfter.length).toBe(auditBefore.length);
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

    const horizonOutbox = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.eventType, "schedule.horizon_maintained"));
    expect(horizonOutbox).toHaveLength(0);
  });

  it("concurrent same key with gap yields one generate audit and outbox (P3-R04/F26/C10)", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);
    const { countBefore } = await seedPlanWithHorizonGap(parentId, studentId);

    const results = await Promise.all([
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

    expect(results.every((result) => result.maintainId === results[0]!.maintainId)).toBe(true);
    expect(results.filter((result) => result.idempotentReplay)).toHaveLength(1);
    expect(results[0]!.itemsCreated).toBeGreaterThan(0);

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
    expect(maintains[0]?.itemsCreated).toBe(results[0]!.itemsCreated);

    const afterItems = await db
      .select()
      .from(scheduleItems)
      .where(eq(scheduleItems.studentId, studentId));
    expect(afterItems.length).toBe(countBefore + results[0]!.itemsCreated);

    const horizonOutbox = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.eventType, "schedule.horizon_maintained"));
    expect(horizonOutbox).toHaveLength(1);

    const horizonAudits = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "schedule.horizon_maintained"));
    expect(horizonAudits).toHaveLength(1);
  });
});
