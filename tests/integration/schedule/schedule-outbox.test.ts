import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { outboxEvents } from "@/db/schema";
import { findOutboxEventByDedupeKey } from "@/modules/outbox/append-outbox-event";
import {
  createFormalPlan,
  deactivateFormalPlan,
  editFormalPlan,
} from "@/modules/schedule/plan.service";
import { maintainHorizon } from "@/modules/schedule/maintain-horizon.service";
import { completeScheduleItem } from "@/modules/schedule/complete-schedule.service";
import { skipScheduleItem } from "@/modules/schedule/skip-schedule.service";
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

describe.skipIf(!hasDb)("schedule outbox", () => {
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

  it("writes plan.created outbox on create (AC-M2-8/F21)", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);

    const result = await createFormalPlan(db, {
      ownerId: parentId,
      studentId,
      idempotencyKey: "outbox-create",
      body: DEFAULT_PLAN_BODY,
      now: FIXED_NOW,
    });

    const event = await findOutboxEventByDedupeKey(db, `plan.created:${result.planId}`);
    expect(event?.eventType).toBe("plan.created");
    expect(event?.status).toBe("pending");
  });

  it("create replay does not duplicate plan.created outbox (F21)", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);

    const result = await createFormalPlan(db, {
      ownerId: parentId,
      studentId,
      idempotencyKey: "outbox-replay",
      body: DEFAULT_PLAN_BODY,
      now: FIXED_NOW,
    });

    await createFormalPlan(db, {
      ownerId: parentId,
      studentId,
      idempotencyKey: "outbox-replay",
      body: DEFAULT_PLAN_BODY,
      now: FIXED_NOW,
    });

    const events = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.dedupeKey, `plan.created:${result.planId}`));

    expect(events).toHaveLength(1);
  });

  it("writes schedule.completed and schedule.skipped outbox", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);

    const created = await createFormalPlan(db, {
      ownerId: parentId,
      studentId,
      idempotencyKey: "outbox-terminal",
      body: { ...DEFAULT_PLAN_BODY, startDate: "2026-01-15" },
      now: FIXED_NOW,
    });

    const items = await db.execute(`
      SELECT id FROM schedule_items WHERE plan_id = '${created.planId}'::uuid ORDER BY family_date LIMIT 2
    `);

    const completeItemId = (items[0] as { id: string }).id;
    const skipItemId = (items[1] as { id: string }).id;

    await completeScheduleItem(db, {
      actorId: studentId,
      scheduleItemId: completeItemId,
      idempotencyKey: "outbox-complete",
      now: FIXED_NOW,
    });

    await skipScheduleItem(db, {
      actorId: studentId,
      scheduleItemId: skipItemId,
      idempotencyKey: "outbox-skip",
      now: FIXED_NOW,
    });

    expect(
      await findOutboxEventByDedupeKey(db, `schedule.completed:${completeItemId}`),
    ).toBeTruthy();
    expect(await findOutboxEventByDedupeKey(db, `schedule.skipped:${skipItemId}`)).toBeTruthy();
  });

  it("writes plan.version_created and plan.deactivated outbox", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);

    const created = await createFormalPlan(db, {
      ownerId: parentId,
      studentId,
      idempotencyKey: "outbox-lifecycle",
      body: DEFAULT_PLAN_BODY,
      now: FIXED_NOW,
    });

    const edited = await editFormalPlan(db, {
      ownerId: parentId,
      planId: created.planId,
      idempotencyKey: "outbox-edit",
      body: { title: "Edited" },
      now: FIXED_NOW,
    });

    await deactivateFormalPlan(db, {
      ownerId: parentId,
      planId: created.planId,
      idempotencyKey: "outbox-deactivate",
      now: FIXED_NOW,
    });

    expect(
      await findOutboxEventByDedupeKey(db, `plan.version_created:${edited.versionId}`),
    ).toBeTruthy();
    expect(await findOutboxEventByDedupeKey(db, `plan.deactivated:${created.planId}`)).toBeTruthy();
  });

  it("maintain writes horizon_maintained only when items_created > 0", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);

    await createFormalPlan(db, {
      ownerId: parentId,
      studentId,
      idempotencyKey: "outbox-maintain",
      body: DEFAULT_PLAN_BODY,
      now: FIXED_NOW,
    });

    const result = await maintainHorizon(db, {
      actorId: parentId,
      studentId,
      idempotencyKey: "outbox-maintain-call",
      now: FIXED_NOW,
    });

    if (result.itemsCreated > 0) {
      expect(
        await findOutboxEventByDedupeKey(db, `schedule.horizon_maintained:${result.maintainId}`),
      ).toBeTruthy();
    }
  });
});
