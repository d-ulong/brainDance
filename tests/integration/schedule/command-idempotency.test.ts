import { config } from "dotenv";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createFormalPlan,
  deactivateFormalPlan,
  editFormalPlan,
} from "@/modules/schedule/plan.service";
import { maintainHorizon } from "@/modules/schedule/maintain-horizon.service";
import { completeScheduleItem } from "@/modules/schedule/complete-schedule.service";
import { skipScheduleItem } from "@/modules/schedule/skip-schedule.service";
import { hashIdempotencyPayload } from "@/modules/schedule/normalize-idempotency-payload";
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

describe.skipIf(!hasDb)("command idempotency", () => {
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

  it("stores consistent payload hash on create (F9-F13)", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);
    const body = DEFAULT_PLAN_BODY;
    const hash = hashIdempotencyPayload(body);

    await createFormalPlan(db, {
      ownerId: parentId,
      studentId,
      idempotencyKey: "hash-create",
      body,
      now: FIXED_NOW,
    });

    const rows = await db.execute(`
      SELECT create_idempotency_payload_hash AS hash FROM plans
      WHERE create_idempotency_key = 'hash-create'
    `);

    expect((rows[0] as { hash: string }).hash).toBe(hash);
  });

  it("allows same key across command types (F13)", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);

    const created = await createFormalPlan(db, {
      ownerId: parentId,
      studentId,
      idempotencyKey: "cross-command-create",
      body: { ...DEFAULT_PLAN_BODY, startDate: "2026-01-15" },
      now: FIXED_NOW,
    });

    await editFormalPlan(db, {
      ownerId: parentId,
      planId: created.planId,
      idempotencyKey: "cross-command-edit",
      body: { title: "Cross command edit" },
      now: FIXED_NOW,
    });

    await maintainHorizon(db, {
      actorId: parentId,
      studentId,
      idempotencyKey: "cross-command-maintain",
      now: FIXED_NOW,
    });

    const items = await db.execute(`
      SELECT id FROM schedule_items
      WHERE plan_id = '${created.planId}'::uuid AND family_date = '2026-01-15'
      LIMIT 1
    `);
    const itemId = (items[0] as { id: string }).id;

    const { completeScheduleItem } = await import("@/modules/schedule/complete-schedule.service");
    await completeScheduleItem(db, {
      actorId: studentId,
      scheduleItemId: itemId,
      idempotencyKey: "cross-command-create",
      now: FIXED_NOW,
    });

    await deactivateFormalPlan(db, {
      ownerId: parentId,
      planId: created.planId,
      idempotencyKey: "cross-command-deactivate",
      now: FIXED_NOW,
    });
  });

  it("edit hash mismatch rejects replay (F10)", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);

    const created = await createFormalPlan(db, {
      ownerId: parentId,
      studentId,
      idempotencyKey: "edit-hash-create",
      body: DEFAULT_PLAN_BODY,
      now: FIXED_NOW,
    });

    await editFormalPlan(db, {
      ownerId: parentId,
      planId: created.planId,
      idempotencyKey: "edit-hash",
      body: { title: "First" },
      now: FIXED_NOW,
    });

    await expect(
      editFormalPlan(db, {
        ownerId: parentId,
        planId: created.planId,
        idempotencyKey: "edit-hash",
        body: { title: "Second" },
        now: FIXED_NOW,
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("deactivate hash mismatch rejects replay (F10)", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);

    const created = await createFormalPlan(db, {
      ownerId: parentId,
      studentId,
      idempotencyKey: "deactivate-hash-create",
      body: DEFAULT_PLAN_BODY,
      now: FIXED_NOW,
    });

    await deactivateFormalPlan(db, {
      ownerId: parentId,
      planId: created.planId,
      idempotencyKey: "deactivate-hash",
      now: FIXED_NOW,
    });

    const plans = await db.execute(`
      SELECT deactivate_idempotency_payload_hash AS hash
      FROM plans WHERE id = '${created.planId}'::uuid
    `);

    expect((plans[0] as { hash: string }).hash).toBe(hashIdempotencyPayload({}));
  });

  it("complete and skip store event payload hash (F20/F24)", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);

    const created = await createFormalPlan(db, {
      ownerId: parentId,
      studentId,
      idempotencyKey: "event-hash-create",
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
      idempotencyKey: "event-complete-hash",
      body: {},
      now: FIXED_NOW,
    });

    await skipScheduleItem(db, {
      actorId: studentId,
      scheduleItemId: skipItemId,
      idempotencyKey: "event-skip-hash",
      body: { reason: "test" },
      now: FIXED_NOW,
    });

    const completeHash = hashIdempotencyPayload({});
    const skipHash = hashIdempotencyPayload({ reason: "test" });

    const events = await db.execute(`
      SELECT idempotency_key, idempotency_payload_hash AS hash
      FROM schedule_events
      WHERE schedule_item_id IN ('${completeItemId}'::uuid, '${skipItemId}'::uuid)
    `);

    const byKey = new Map(
      (events as unknown as { idempotency_key: string; hash: string }[]).map((row) => [
        row.idempotency_key,
        row.hash,
      ]),
    );

    expect(byKey.get("event-complete-hash")).toBe(completeHash);
    expect(byKey.get("event-skip-hash")).toBe(skipHash);
  });
});
