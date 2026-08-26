import { config } from "dotenv";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  auditEvents,
  outboxEvents,
  planScheduleSlots,
  planVersions,
  plans,
  scheduleItems,
} from "@/db/schema";
import { findOutboxEventByDedupeKey } from "@/modules/outbox/append-outbox-event";
import {
  createFormalPlan,
  deactivateFormalPlan,
  editFormalPlan,
} from "@/modules/schedule/plan.service";
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

describe.skipIf(!hasDb)("formal plan", () => {
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

  it("creates formal plan with inline horizon and outbox", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);

    const result = await createFormalPlan(db, {
      ownerId: parentId,
      studentId,
      idempotencyKey: "create-1",
      body: DEFAULT_PLAN_BODY,
      now: FIXED_NOW,
    });

    expect(result.idempotentReplay).toBe(false);
    expect(result.itemsCreated).toBeGreaterThan(0);

    const outbox = await findOutboxEventByDedupeKey(db, `plan.created:${result.planId}`);
    expect(outbox?.eventType).toBe("plan.created");

    const items = await db
      .select()
      .from(scheduleItems)
      .where(eq(scheduleItems.studentId, studentId));
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((item) => item.ownerId === parentId)).toBe(true);
    expect(items.every((item) => item.slotKey === "default")).toBe(true);
    expect(items.every((item) => item.source === "plan")).toBe(true);
  });

  it("replays create before active plan conflict (F9b)", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);

    const first = await createFormalPlan(db, {
      ownerId: parentId,
      studentId,
      idempotencyKey: "create-replay",
      body: DEFAULT_PLAN_BODY,
      now: FIXED_NOW,
    });

    const replay = await createFormalPlan(db, {
      ownerId: parentId,
      studentId,
      idempotencyKey: "create-replay",
      body: DEFAULT_PLAN_BODY,
      now: FIXED_NOW,
    });

    expect(replay.idempotentReplay).toBe(true);
    expect(replay.planId).toBe(first.planId);

    const outboxCount = await db.select().from(outboxEvents);
    expect(outboxCount.filter((row) => row.eventType === "plan.created")).toHaveLength(1);
  });

  it("rejects create with same key different payload (F9)", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);

    await createFormalPlan(db, {
      ownerId: parentId,
      studentId,
      idempotencyKey: "create-conflict",
      body: DEFAULT_PLAN_BODY,
      now: FIXED_NOW,
    });

    await expect(
      createFormalPlan(db, {
        ownerId: parentId,
        studentId,
        idempotencyKey: "create-conflict",
        body: { ...DEFAULT_PLAN_BODY, title: "Different" },
        now: FIXED_NOW,
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" satisfies ScheduleError["code"] });
  });

  it("rejects second active formal plan for same student", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);

    await createFormalPlan(db, {
      ownerId: parentId,
      studentId,
      idempotencyKey: "create-a",
      body: DEFAULT_PLAN_BODY,
      now: FIXED_NOW,
    });

    await expect(
      createFormalPlan(db, {
        ownerId: parentId,
        studentId,
        idempotencyKey: "create-b",
        body: DEFAULT_PLAN_BODY,
        now: FIXED_NOW,
      }),
    ).rejects.toMatchObject({ code: "STATE_CONFLICT" });
  });

  it("edits plan creating new version and slot snapshot (F27/C12)", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);

    const created = await createFormalPlan(db, {
      ownerId: parentId,
      studentId,
      idempotencyKey: "create-edit",
      body: DEFAULT_PLAN_BODY,
      now: FIXED_NOW,
    });

    const edited = await editFormalPlan(db, {
      ownerId: parentId,
      planId: created.planId,
      idempotencyKey: "edit-1",
      body: { title: "Updated title" },
      now: FIXED_NOW,
    });

    expect(edited.idempotentReplay).toBe(false);
    expect(edited.versionId).not.toBe(created.versionId);

    const slots = await db
      .select()
      .from(planScheduleSlots)
      .where(eq(planScheduleSlots.planVersionId, edited.versionId));
    expect(slots).toHaveLength(1);
    expect(slots[0]?.localTime).toBe("20:00:00");

    const outbox = await findOutboxEventByDedupeKey(db, `plan.version_created:${edited.versionId}`);
    expect(outbox?.eventType).toBe("plan.version_created");
  });

  it("edit replays without second outbox (F21 pattern for edit)", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);

    const created = await createFormalPlan(db, {
      ownerId: parentId,
      studentId,
      idempotencyKey: "create-edit-replay",
      body: DEFAULT_PLAN_BODY,
      now: FIXED_NOW,
    });

    const first = await editFormalPlan(db, {
      ownerId: parentId,
      planId: created.planId,
      idempotencyKey: "edit-replay",
      body: { localTime: "21:00" },
      now: FIXED_NOW,
    });

    const replay = await editFormalPlan(db, {
      ownerId: parentId,
      planId: created.planId,
      idempotencyKey: "edit-replay",
      body: { localTime: "21:00" },
      now: FIXED_NOW,
    });

    expect(replay.idempotentReplay).toBe(true);
    expect(replay.versionId).toBe(first.versionId);

    const versionOutbox = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.eventType, "plan.version_created"));
    expect(versionOutbox).toHaveLength(1);
  });

  it("deactivates plan cancelling future pending", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);

    const created = await createFormalPlan(db, {
      ownerId: parentId,
      studentId,
      idempotencyKey: "create-deactivate",
      body: DEFAULT_PLAN_BODY,
      now: FIXED_NOW,
    });

    const deactivated = await deactivateFormalPlan(db, {
      ownerId: parentId,
      planId: created.planId,
      idempotencyKey: "deactivate-1",
      now: FIXED_NOW,
    });

    expect(deactivated.status).toBe("inactive");

    const [plan] = await db.select().from(plans).where(eq(plans.id, created.planId)).limit(1);
    expect(plan?.status).toBe("inactive");

    const futurePending = await db
      .select()
      .from(scheduleItems)
      .where(and(eq(scheduleItems.planId, created.planId), eq(scheduleItems.status, "cancelled")));
    expect(futurePending.length).toBeGreaterThan(0);

    const audit = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "formal_plan.deactivated"));
    expect(audit.length).toBe(1);
  });

  it("allows same idempotency key across students (F12)", async () => {
    const pairA = await bootstrapParentStudentRelationship(db);
    const pairB = await bootstrapParentStudentRelationship(db);

    const planA = await createFormalPlan(db, {
      ownerId: pairA.parentId,
      studentId: pairA.studentId,
      idempotencyKey: "shared-key",
      body: DEFAULT_PLAN_BODY,
      now: FIXED_NOW,
    });

    const planB = await createFormalPlan(db, {
      ownerId: pairB.parentId,
      studentId: pairB.studentId,
      idempotencyKey: "shared-key",
      body: DEFAULT_PLAN_BODY,
      now: FIXED_NOW,
    });

    expect(planA.planId).not.toBe(planB.planId);
  });

  it("edit copies localTime from old version when omitted (R7)", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);

    const created = await createFormalPlan(db, {
      ownerId: parentId,
      studentId,
      idempotencyKey: "create-localtime",
      body: { ...DEFAULT_PLAN_BODY, localTime: "19:30" },
      now: FIXED_NOW,
    });

    const edited = await editFormalPlan(db, {
      ownerId: parentId,
      planId: created.planId,
      idempotencyKey: "edit-localtime",
      body: { title: "Same time" },
      now: FIXED_NOW,
    });

    const [slot] = await db
      .select()
      .from(planScheduleSlots)
      .where(eq(planScheduleSlots.planVersionId, edited.versionId))
      .limit(1);

    expect(slot?.localTime).toBe("19:30:00");

    const newItems = await db
      .select()
      .from(scheduleItems)
      .where(eq(scheduleItems.planVersionId, edited.versionId));

    expect(newItems.some((item) => item.occurrenceKey.includes(":daily:19:30"))).toBe(true);
  });

  it("edit with changed localTime uses new slot time (R6)", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);

    const created = await createFormalPlan(db, {
      ownerId: parentId,
      studentId,
      idempotencyKey: "create-change-time",
      body: DEFAULT_PLAN_BODY,
      now: FIXED_NOW,
    });

    const edited = await editFormalPlan(db, {
      ownerId: parentId,
      planId: created.planId,
      idempotencyKey: "edit-change-time",
      body: { localTime: "21:15" },
      now: FIXED_NOW,
    });

    const newItems = await db
      .select()
      .from(scheduleItems)
      .where(eq(scheduleItems.planVersionId, edited.versionId));

    expect(newItems.some((item) => item.occurrenceKey.includes(":daily:21:15"))).toBe(true);
  });

  it("edit replay returns existing version without duplicate rows", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);

    const created = await createFormalPlan(db, {
      ownerId: parentId,
      studentId,
      idempotencyKey: "create-version-count",
      body: DEFAULT_PLAN_BODY,
      now: FIXED_NOW,
    });

    await editFormalPlan(db, {
      ownerId: parentId,
      planId: created.planId,
      idempotencyKey: "edit-version-count",
      body: { description: "v2" },
      now: FIXED_NOW,
    });

    await editFormalPlan(db, {
      ownerId: parentId,
      planId: created.planId,
      idempotencyKey: "edit-version-count",
      body: { description: "v2" },
      now: FIXED_NOW,
    });

    const versions = await db
      .select()
      .from(planVersions)
      .where(eq(planVersions.planId, created.planId));

    expect(versions).toHaveLength(2);
  });
});
