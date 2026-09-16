import { config } from "dotenv";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { factVersions, planActivations, planItemRules, planLibrary, plans, pointLedgerEntries, scheduleItems } from "@/db/schema";
import { completeScheduleItem } from "@/modules/schedule/complete-schedule.service";
import { clearScheduleItems } from "@/modules/schedule/clear-schedule.service";
import { queryScheduleItems } from "@/modules/schedule/schedule-query.service";
import {
  activatePlanLibrary,
  createPlanLibrary,
  generatePlanLibraryRange,
  listPlanLibrary,
  listStudentPlanLibrary,
  removePlanLibraryBinding,
  updatePlanLibrary,
} from "@/modules/schedule/plan-library.service";
import { startPlanItem } from "@/modules/schedule/start-plan-item.service";
import { createFormalPlan } from "@/modules/schedule/plan.service";
import { persistExpiredPastWindow } from "@/modules/schedule/persist-expired.service";
import {
  bootstrapParentStudentRelationship,
  FIXED_NOW,
  resetScheduleTables,
} from "../../helpers/schedule";
import { closeTestDb, getTestDb, migrateTestDb, resetIdentityTables } from "../../helpers/db";

config({ path: ".env.local" });
config({ path: ".env" });
const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);
const definition = {
  title: "放学计划",
  startDate: "2026-01-15",
  entries: [
    {
      key: "reading",
      title: "阅读",
      expectedTime: "18:30",
      latestStartTime: "19:00",
      durationMinutes: 30,
      repeat: { kind: "daily" },
      points: { onTimeWithin: 10, onTimeOver: 5, lateWithin: 3, lateOver: 0, incomplete: -2 },
    },
    {
      key: "sport",
      title: "运动",
      expectedTime: "20:00",
      durationMinutes: null,
      repeat: { kind: "weekly", weekdays: [4] },
      points: { onTimeWithin: 3, onTimeOver: 0, lateWithin: 0, lateOver: 0, incomplete: 0 },
    },
  ],
};

describe.skipIf(!hasDb)("plan library activation", () => {
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
  it("creates reusable content and permits another plan to run alongside it", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);
    const saved = await createPlanLibrary(db, {
      ownerId: parentId,
      definition,
      idempotencyKey: "library-1",
    });
    const replay = await createPlanLibrary(db, {
      ownerId: parentId,
      definition,
      idempotencyKey: "library-1",
    });
    expect(replay.id).toBe(saved.id);
    const first = await activatePlanLibrary(db, {
      ownerId: parentId,
      studentId,
      libraryId: saved.id,
      effectiveFrom: "2026-01-15",
      idempotencyKey: "activate-1",
      now: FIXED_NOW,
    });
    const listedAfterActivation = await listPlanLibrary(db, parentId);
    expect(
      listedAfterActivation
        .find((library) => library.id === saved.id)
        ?.bindings.map((binding) => binding.studentId),
    ).toEqual([studentId]);
    expect(first.itemsCreated).toBeGreaterThan(10);
    const [reading] = await db
      .select()
      .from(scheduleItems)
      .where(
        and(
          eq(scheduleItems.planId, first.planId),
          eq(scheduleItems.slotKey, "reading"),
          eq(scheduleItems.familyDate, "2026-01-15"),
        ),
      )
      .limit(1);
    expect(reading).toBeTruthy();
    await startPlanItem(db, {
      actorId: studentId,
      scheduleItemId: reading!.id,
      idempotencyKey: "start-reading",
      now: new Date("2026-01-15T10:30:00.000Z"),
    });
    await completeScheduleItem(db, {
      actorId: studentId,
      scheduleItemId: reading!.id,
      idempotencyKey: "complete-reading",
      now: new Date("2026-01-15T11:00:00.000Z"),
    });
    const [ledger] = await db
      .select()
      .from(pointLedgerEntries)
      .where(eq(pointLedgerEntries.studentId, studentId))
      .limit(1);
    expect(ledger?.amount).toBe(10);
    await persistExpiredPastWindow(db, studentId, new Date("2026-01-17T10:01:00.000Z"));
    const incompleteLedgers = await db
      .select()
      .from(pointLedgerEntries)
      .where(eq(pointLedgerEntries.studentId, studentId));
    expect(incompleteLedgers.some((entry) => entry.amount === -2)).toBe(true);
    const generated = await generatePlanLibraryRange(db, {
      ownerId: parentId,
      studentId,
      libraryId: saved.id,
      from: "2026-01-30",
      through: "2026-02-05",
      idempotencyKey: "generate-1",
      now: FIXED_NOW,
    });
    expect(generated.itemsCreated).toBeGreaterThan(0);
    const generateReplay = await generatePlanLibraryRange(db, {
      ownerId: parentId,
      studentId,
      libraryId: saved.id,
      from: "2026-01-30",
      through: "2026-02-05",
      idempotencyKey: "generate-1",
      now: FIXED_NOW,
    });
    expect(generateReplay.idempotentReplay).toBe(true);
    const next = await createPlanLibrary(db, {
      ownerId: parentId,
      definition: { ...definition, title: "新计划" },
      idempotencyKey: "library-2",
    });
    await activatePlanLibrary(db, {
      ownerId: parentId,
      studentId,
      libraryId: next.id,
      effectiveFrom: "2026-01-17",
      idempotencyKey: "activate-2",
      now: FIXED_NOW,
    });
    const activations = await db
      .select()
      .from(planActivations)
      .where(eq(planActivations.studentId, studentId));
    expect(activations.filter((row) => row.effectiveUntil === null)).toHaveLength(2);
    const oldFuture = await db
      .select()
      .from(scheduleItems)
      .where(
        and(eq(scheduleItems.planId, first.planId), eq(scheduleItems.familyDate, "2026-01-17")),
      );
    expect(oldFuture.length).toBeGreaterThan(0);
    expect(oldFuture.every((item) => item.status === "pending")).toBe(true);
    expect(await db.select().from(planLibrary).where(eq(planLibrary.id, saved.id))).toHaveLength(1);
  });
  it("lets a student manage own plans and generate only their bound plans", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);
    const own = await createPlanLibrary(db, {
      ownerId: studentId,
      definition: { ...definition, title: "我的自主计划" },
      idempotencyKey: "student-own-library",
    });
    const activated = await activatePlanLibrary(db, {
      ownerId: studentId,
      studentId,
      libraryId: own.id,
      effectiveFrom: "2026-01-15",
      idempotencyKey: "student-own-activate",
      now: FIXED_NOW,
    });
    expect(activated.itemsCreated).toBeGreaterThan(0);
    expect(
      (await listStudentPlanLibrary(db, studentId)).find((plan) => plan.id === own.id)
        ?.definition.entries[0]?.points.onTimeWithin,
    ).toBe(0);

    const parentPlan = await createPlanLibrary(db, {
      ownerId: parentId,
      definition: { ...definition, title: "家长安排" },
      idempotencyKey: "parent-assigned-library",
    });
    await activatePlanLibrary(db, {
      ownerId: parentId,
      studentId,
      libraryId: parentPlan.id,
      effectiveFrom: "2026-01-15",
      idempotencyKey: "parent-assigned-activate",
      now: FIXED_NOW,
    });

    const visible = await listStudentPlanLibrary(db, studentId);
    expect(visible.find((plan) => plan.id === own.id)).toMatchObject({ canEdit: true, boundToSelf: true });
    expect(visible.find((plan) => plan.id === parentPlan.id)).toMatchObject({ canEdit: false, boundToSelf: true });

    const generated = await generatePlanLibraryRange(db, {
      ownerId: studentId,
      studentId,
      libraryId: parentPlan.id,
      from: "2026-01-30",
      through: "2026-02-02",
      idempotencyKey: "student-generate-parent-plan",
      now: FIXED_NOW,
    });
    expect(generated.itemsCreated).toBeGreaterThan(0);
    await expect(
      updatePlanLibrary(db, {
        ownerId: studentId,
        libraryId: parentPlan.id,
        revision: parentPlan.revision,
        definition,
        idempotencyKey: "student-edit-parent-plan",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("lets a parent bind, generate, and list a zero-point personal plan", async () => {
    const { parentId } = await bootstrapParentStudentRelationship(db);
    const own = await createPlanLibrary(db, {
      ownerId: parentId,
      definition: { ...definition, title: "家长个人计划" },
      idempotencyKey: "parent-personal-library",
    });
    const activated = await activatePlanLibrary(db, {
      ownerId: parentId,
      studentId: parentId,
      libraryId: own.id,
      effectiveFrom: "2026-01-15",
      idempotencyKey: "parent-personal-activate",
      now: FIXED_NOW,
    });
    expect(activated.itemsCreated).toBeGreaterThan(0);
    const visible = (await listPlanLibrary(db, parentId)).find((plan) => plan.id === own.id);
    expect(visible?.bindings).toEqual(expect.arrayContaining([expect.objectContaining({ studentId: parentId })]));
    const generated = await generatePlanLibraryRange(db, {
      ownerId: parentId,
      studentId: parentId,
      libraryId: own.id,
      from: "2026-01-30",
      through: "2026-02-02",
      idempotencyKey: "parent-personal-generate",
      now: FIXED_NOW,
    });
    expect(generated.itemsCreated).toBeGreaterThan(0);
    const personalPlan = await db.select().from(plans).where(eq(plans.id, activated.planId));
    expect(personalPlan[0]?.planKind).toBe("personal");
    const personalItems = await db.select({ entry: planItemRules.entry }).from(planItemRules).innerJoin(scheduleItems, eq(scheduleItems.id, planItemRules.scheduleItemId)).where(eq(scheduleItems.planId, activated.planId));
    expect(personalItems.length).toBeGreaterThan(0);
    expect(personalItems.every((item) => {
      const entry = item.entry as typeof definition.entries[number];
      return entry.points.onTimeWithin === 0 && entry.points.incomplete === 0;
    })).toBe(true);
  });

  it("projects started work, accepts a direct completion interval, and settles its points", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);
    const saved = await createPlanLibrary(db, { ownerId: parentId, definition, idempotencyKey: "manual-complete-library" });
    const active = await activatePlanLibrary(db, { ownerId: parentId, studentId, libraryId: saved.id, effectiveFrom: "2026-01-15", idempotencyKey: "manual-complete-activate", now: FIXED_NOW });
    const [reading] = await db.select().from(scheduleItems).where(and(eq(scheduleItems.planId, active.planId), eq(scheduleItems.familyDate, "2026-01-15"), eq(scheduleItems.slotKey, "reading"))).limit(1);
    await startPlanItem(db, { actorId: studentId, scheduleItemId: reading!.id, idempotencyKey: "manual-status-start", now: new Date("2026-01-15T10:30:00.000Z") });
    const projected = (await queryScheduleItems(db, { studentId, from: "2026-01-15", to: "2026-01-15", now: new Date("2026-01-15T10:40:00.000Z") })).find((item) => item.id === reading!.id);
    expect(projected?.effectiveStatus).toBe("in_progress");

    const result = await completeScheduleItem(db, { actorId: studentId, scheduleItemId: reading!.id, idempotencyKey: "manual-status-complete", body: { durationMinutes: 30 }, now: new Date("2026-01-15T11:30:00.000Z") });
    expect(result.completionKind).toBe("on_time");
    const [fact] = await db.select().from(factVersions).where(eq(factVersions.id, result.factVersionId));
    expect(fact).toMatchObject({ sourceKind: "manual", submittedBy: studentId });
    const [ledger] = await db.select().from(pointLedgerEntries).where(eq(pointLedgerEntries.studentId, studentId)).limit(1);
    expect(ledger?.amount).toBe(10);
  });

  it("lets a related parent start and complete a student's task with an auditable points fact", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);
    const saved = await createPlanLibrary(db, { ownerId: parentId, definition, idempotencyKey: "parent-operates-library" });
    const active = await activatePlanLibrary(db, { ownerId: parentId, studentId, libraryId: saved.id, effectiveFrom: "2026-01-15", idempotencyKey: "parent-operates-activate", now: FIXED_NOW });
    const [reading] = await db.select().from(scheduleItems).where(and(eq(scheduleItems.planId, active.planId), eq(scheduleItems.familyDate, "2026-01-15"), eq(scheduleItems.slotKey, "reading"))).limit(1);
    await startPlanItem(db, { actorId: parentId, actorRole: "parent", scheduleItemId: reading!.id, idempotencyKey: "parent-starts-task", now: new Date("2026-01-15T10:30:00.000Z") });
    const result = await completeScheduleItem(db, { actorId: parentId, actorRole: "parent", scheduleItemId: reading!.id, idempotencyKey: "parent-completes-task", body: { durationMinutes: 30 }, now: new Date("2026-01-15T11:00:00.000Z") });
    const [fact] = await db.select().from(factVersions).where(eq(factVersions.id, result.factVersionId));
    const [ledger] = await db.select().from(pointLedgerEntries).where(eq(pointLedgerEntries.studentId, studentId)).limit(1);
    expect(fact).toMatchObject({ sourceKind: "manual", submittedBy: parentId });
    expect(ledger?.amount).toBe(10);
  });

  it("clears only authorized unstarted future work and replays safely", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);
    const parentLibrary = await createPlanLibrary(db, { ownerId: parentId, definition, idempotencyKey: "clear-parent-library" });
    const active = await activatePlanLibrary(db, { ownerId: parentId, studentId, libraryId: parentLibrary.id, effectiveFrom: "2026-01-15", idempotencyKey: "clear-parent-activate", now: FIXED_NOW });
    const [started] = await db.select().from(scheduleItems).where(and(eq(scheduleItems.planId, active.planId), eq(scheduleItems.familyDate, "2026-01-15"), eq(scheduleItems.slotKey, "reading"))).limit(1);
    await startPlanItem(db, { actorId: studentId, scheduleItemId: started!.id, idempotencyKey: "clear-protected-start", now: new Date("2026-01-15T10:30:00.000Z") });

    const studentAttempt = await clearScheduleItems(db, { actorId: studentId, actorRole: "student", studentId, from: "2026-01-15", through: "2026-01-20", idempotencyKey: "student-clear-parent", now: FIXED_NOW });
    expect(studentAttempt.clearedCount).toBe(0);
    const parentResult = await clearScheduleItems(db, { actorId: parentId, actorRole: "parent", studentId, from: "2026-01-15", through: "2026-01-20", idempotencyKey: "parent-clear", now: FIXED_NOW });
    expect(parentResult.clearedCount).toBeGreaterThan(0);
    const [protectedItem] = await db.select().from(scheduleItems).where(eq(scheduleItems.id, started!.id));
    expect(protectedItem?.status).toBe("pending");
    const replay = await clearScheduleItems(db, { actorId: parentId, actorRole: "parent", studentId, from: "2026-01-15", through: "2026-01-20", idempotencyKey: "parent-clear", now: FIXED_NOW });
    expect(replay).toMatchObject({ clearedCount: parentResult.clearedCount, idempotentReplay: true });
    await expect(clearScheduleItems(db, { actorId: parentId, actorRole: "parent", studentId, from: "2026-01-15", through: "2026-04-15", idempotencyKey: "parent-clear-too-long", now: FIXED_NOW })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
  it("removes an active student binding without deleting prior facts or charging a penalty", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);
    const saved = await createPlanLibrary(db, {
      ownerId: parentId,
      definition,
      idempotencyKey: "remove-library",
    });
    const active = await activatePlanLibrary(db, {
      ownerId: parentId,
      studentId,
      libraryId: saved.id,
      effectiveFrom: "2026-01-15",
      idempotencyKey: "remove-activate",
      now: FIXED_NOW,
    });
    const result = await removePlanLibraryBinding(db, {
      ownerId: parentId,
      studentId,
      libraryId: saved.id,
      idempotencyKey: "remove-binding",
      now: FIXED_NOW,
    });
    expect(result.idempotentReplay).toBe(false);
    expect(result.cancelledItems).toBeGreaterThan(0);
    expect(
      (await listPlanLibrary(db, parentId)).find((library) => library.id === saved.id)?.bindings,
    ).toEqual([]);
    const pending = await db
      .select()
      .from(scheduleItems)
      .where(eq(scheduleItems.planId, active.planId));
    expect(pending.length).toBeGreaterThan(0);
    expect(pending.every((item) => item.status === "cancelled")).toBe(true);
    const replay = await removePlanLibraryBinding(db, {
      ownerId: parentId,
      studentId,
      libraryId: saved.id,
      idempotencyKey: "remove-binding",
      now: FIXED_NOW,
    });
    expect(replay.idempotentReplay).toBe(true);
  });

  it("binds two plans on the same future effective date", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);
    const firstLibrary = await createPlanLibrary(db, {
      ownerId: parentId,
      definition,
      priority: 1,
      idempotencyKey: "same-day-first-library",
    });
    const secondLibrary = await createPlanLibrary(db, {
      ownerId: parentId,
      definition: { ...definition, title: "同日切换计划" },
      priority: 10,
      idempotencyKey: "same-day-second-library",
    });
    await activatePlanLibrary(db, {
      ownerId: parentId,
      studentId,
      libraryId: firstLibrary.id,
      effectiveFrom: "2026-01-16",
      idempotencyKey: "same-day-first-activation",
      now: FIXED_NOW,
    });

    const replacement = await activatePlanLibrary(db, {
      ownerId: parentId,
      studentId,
      libraryId: secondLibrary.id,
      effectiveFrom: "2026-01-16",
      idempotencyKey: "same-day-second-activation",
      now: FIXED_NOW,
    });

    expect(replacement.itemsCreated).toBeGreaterThan(0);
    const active = await db
      .select()
      .from(planActivations)
      .where(and(eq(planActivations.studentId, studentId), isNull(planActivations.effectiveUntil)));
    expect(active).toHaveLength(2);
    expect(active.some((row) => row.executionPlanId === replacement.planId)).toBe(true);
    const sameTime = await db.select().from(scheduleItems).where(and(
      eq(scheduleItems.studentId, studentId),
      eq(scheduleItems.familyDate, "2026-01-16"),
      eq(scheduleItems.slotKey, "reading"),
    ));
    const high = sameTime.find((item) => item.planId === replacement.planId);
    const low = sameTime.find((item) => item.planId !== replacement.planId);
    expect(high?.suppressedByScheduleItemId).toBeNull();
    expect(low?.suppressedByScheduleItemId).toBe(high?.id);
  });

  it("keeps a legacy formal plan alongside a library plan", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);
    const legacy = await createFormalPlan(db, {
      ownerId: parentId,
      studentId,
      idempotencyKey: "legacy-formal-plan",
      body: { title: "旧式计划", localTime: "18:00", startDate: "2026-01-15" },
      now: FIXED_NOW,
    });
    const saved = await createPlanLibrary(db, {
      ownerId: parentId,
      definition,
      idempotencyKey: "replace-legacy-library",
    });

    const replacement = await activatePlanLibrary(db, {
      ownerId: parentId,
      studentId,
      libraryId: saved.id,
      effectiveFrom: "2026-01-16",
      idempotencyKey: "replace-legacy-activation",
      now: FIXED_NOW,
    });

    expect(replacement.itemsCreated).toBeGreaterThan(0);
    const [retiredLegacy] = await db.select().from(plans).where(eq(plans.id, legacy.planId));
    expect(retiredLegacy?.status).toBe("active");
    const legacyFutureItems = await db
      .select()
      .from(scheduleItems)
      .where(and(eq(scheduleItems.planId, legacy.planId), eq(scheduleItems.familyDate, "2026-01-16")));
    expect(legacyFutureItems).not.toHaveLength(0);
    expect(legacyFutureItems.every((item) => item.status === "pending")).toBe(true);
  });

  it("generates the active intersection when a requested range starts before a newly switched plan", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);
    const saved = await createPlanLibrary(db, {
      ownerId: parentId,
      definition,
      idempotencyKey: "overlap-library",
    });
    await activatePlanLibrary(db, {
      ownerId: parentId,
      studentId,
      libraryId: saved.id,
      effectiveFrom: "2026-01-16",
      idempotencyKey: "overlap-activate",
      now: FIXED_NOW,
    });

    const generated = await generatePlanLibraryRange(db, {
      ownerId: parentId,
      studentId,
      libraryId: saved.id,
      from: "2026-01-15",
      through: "2026-01-20",
      idempotencyKey: "overlap-generate",
      now: FIXED_NOW,
    });

    expect(generated).toMatchObject({
      generatedFrom: "2026-01-16",
      generatedThrough: "2026-01-20",
    });
  });

  it("projects entry description snapshot and generatedDatesByStudent from schedule facts", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);
    const withDescription = {
      ...definition,
      entries: [
        {
          ...definition.entries[0],
          description: "先完成今日阅读笔记",
        },
        definition.entries[1],
      ],
    };
    const saved = await createPlanLibrary(db, {
      ownerId: parentId,
      definition: withDescription,
      idempotencyKey: "desc-dates-library",
    });
    const active = await activatePlanLibrary(db, {
      ownerId: parentId,
      studentId,
      libraryId: saved.id,
      effectiveFrom: "2026-01-15",
      idempotencyKey: "desc-dates-activate",
      now: FIXED_NOW,
    });
    await generatePlanLibraryRange(db, {
      ownerId: parentId,
      studentId,
      libraryId: saved.id,
      from: "2026-01-15",
      through: "2026-01-17",
      idempotencyKey: "desc-dates-generate",
      now: FIXED_NOW,
    });

    const listed = (await listPlanLibrary(db, parentId)).find((plan) => plan.id === saved.id);
    expect(listed?.generatedDatesByStudent?.[studentId]).toEqual(
      expect.arrayContaining(["2026-01-15", "2026-01-16", "2026-01-17"]),
    );

    const projected = (
      await queryScheduleItems(db, {
        studentId,
        from: "2026-01-15",
        to: "2026-01-15",
        now: new Date("2026-01-15T10:40:00.000Z"),
      })
    ).find((item) => item.slotKey === "reading" && item.planId === active.planId);
    expect(projected?.description).toBe("先完成今日阅读笔记");
  });

  it("auto-generates the next 15 applicable days when plan startDate is beyond default activate window", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);
    const farStart = "2026-03-01";
    const saved = await createPlanLibrary(db, {
      ownerId: parentId,
      definition: {
        title: "三月阅读",
        startDate: farStart,
        entries: [
          {
            key: "reading",
            title: "阅读",
            expectedTime: "19:00",
            durationMinutes: null,
            repeat: { kind: "daily" },
            points: { onTimeWithin: 1, onTimeOver: 0, lateWithin: 0, lateOver: 0, incomplete: 0 },
          },
        ],
      },
      idempotencyKey: "far-start-library",
    });
    const activated = await activatePlanLibrary(db, {
      ownerId: parentId,
      studentId,
      libraryId: saved.id,
      idempotencyKey: "far-start-activate",
      now: FIXED_NOW,
    });
    expect(activated.effectiveFrom).toBe(farStart);
    expect(activated.generatedFrom).toBe(farStart);
    expect(activated.generatedThrough).toBe("2026-03-15");
    expect(activated.itemsCreated).toBe(15);
    expect(activated.matchedOccurrences).toBe(15);
    const rows = await db
      .select({ familyDate: scheduleItems.familyDate })
      .from(scheduleItems)
      .where(eq(scheduleItems.planId, activated.planId));
    expect(rows).toHaveLength(15);
    expect(rows.map((row) => row.familyDate).sort()).toEqual(
      expect.arrayContaining(["2026-03-01", "2026-03-15"]),
    );
  });

});
