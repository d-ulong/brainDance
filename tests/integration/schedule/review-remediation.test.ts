import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  factVersions,
  planItemRules,
  pointBalanceProjection,
  pointLedgerEntries,
  pointRuleVersions,
  settlements,
  scheduleItems,
  scheduleTaskExecutions,
} from "@/db/schema";
import { completeScheduleItem } from "@/modules/schedule/complete-schedule.service";
import {
  createPlanLibrary,
  activatePlanLibrary,
  removePlanLibraryBinding,
} from "@/modules/schedule/plan-library.service";
import { queryScheduleItems } from "@/modules/schedule/schedule-query.service";
import { startPlanItem } from "@/modules/schedule/start-plan-item.service";
import { updateTaskExecution } from "@/modules/schedule/task-execution.service";
import { persistExpiredPastWindow } from "@/modules/schedule/persist-expired.service";
import { createFormalPlan } from "@/modules/schedule/plan.service";
import {
  bootstrapParentStudentRelationship,
  enableSchedulePointRule,
  resetScheduleTables,
} from "../../helpers/schedule";
import { closeTestDb, getTestDb, migrateTestDb, resetIdentityTables } from "../../helpers/db";

const now = new Date("2026-01-15T10:00:00Z");
const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);
const points = { onTimeWithin: 10, onTimeOver: 5, lateWithin: 3, lateOver: 1, incomplete: -2 };
const checklist = [
  { id: "math", title: "数学", completed: true, difficulty: "较难", durationMinutes: 20 },
];

describe.skipIf(!hasDb)("review schedule remediation", () => {
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

  async function seed(input?: {
    owner?: "student" | "parent";
    self?: boolean;
    priority?: number;
    taskType?: "homework" | "exercise";
    date?: string;
  }) {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);
    const ownerId = input?.owner === "student" ? studentId : parentId;
    const subjectId = input?.self ? ownerId : studentId;
    const date = input?.date ?? "2026-01-15";
    const definition = {
      title: "测试计划",
      startDate: date,
      entries: [
        {
          key: "a",
          title: "测试任务",
          expectedTime: "18:00",
          taskType: input?.taskType ?? "homework",
          repeat: { kind: "once", date },
          points,
        },
      ],
    };
    const library = await createPlanLibrary(db, {
      ownerId,
      definition,
      priority: input?.priority,
      idempotencyKey: crypto.randomUUID(),
    });
    const activation = await activatePlanLibrary(db, {
      ownerId,
      studentId: subjectId,
      libraryId: library.id,
      effectiveFrom: date,
      idempotencyKey: crypto.randomUUID(),
      now,
    });
    const [item] = await db
      .select()
      .from(scheduleItems)
      .where(eq(scheduleItems.planId, activation.planId))
      .limit(1);
    if (!item) throw new Error("Missing schedule item");
    return {
      parentId,
      studentId: subjectId,
      ownerId,
      itemId: item.id,
      definition,
      libraryId: library.id,
    };
  }
  async function balance(studentId: string) {
    return (
      (
        await db
          .select()
          .from(pointBalanceProjection)
          .where(eq(pointBalanceProjection.studentId, studentId))
      )[0]?.balance ?? 0
    );
  }

  async function seedLegacyCompletion(withoutSettlement = false) {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);
    const rule = await enableSchedulePointRule(db, { parentId, studentId });
    const plan = await createFormalPlan(db, {
      ownerId: parentId,
      studentId,
      idempotencyKey: "legacy-plan",
      body: { title: "历史正式计划", localTime: "18:00", startDate: "2026-01-15" },
      now,
    });
    const [item] = await db
      .select()
      .from(scheduleItems)
      .where(
        and(eq(scheduleItems.planId, plan.planId), eq(scheduleItems.familyDate, "2026-01-15")),
      );
    if (!item) throw new Error("Missing legacy item");
    const done = await completeScheduleItem(db, {
      actorId: studentId,
      scheduleItemId: item.id,
      idempotencyKey: "legacy-complete",
      now,
      ...(withoutSettlement
        ? {
            settleForFact: async () => ({
              settlementId: crypto.randomUUID(),
              ledgerEntryId: crypto.randomUUID(),
            }),
          }
        : {}),
    });
    return { parentId, studentId, rule, itemId: item.id, done };
  }

  it("retains homework metadata, replays commands and rejects conflicting payload/stale versions", async () => {
    const { studentId, itemId } = await seed();
    const input = {
      actorId: studentId,
      actorRole: "student" as const,
      scheduleItemId: itemId,
      expectedRevision: 0,
      checklist,
      idempotencyKey: "save",
      now,
    };
    const first = await updateTaskExecution(db, input);
    const replay = await updateTaskExecution(db, input);
    expect(first.revision).toBe(1);
    expect(replay).toEqual({ ...first, idempotentReplay: true });
    await expect(
      updateTaskExecution(db, { ...input, checklist: [{ ...checklist[0]!, completed: false }] }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await expect(
      updateTaskExecution(db, { ...input, idempotencyKey: "stale" }),
    ).rejects.toMatchObject({ code: "STATE_CONFLICT" });
    const rows = await queryScheduleItems(db, {
      studentId,
      from: "2026-01-15",
      to: "2026-01-15",
      now,
    });
    expect(rows[0]?.checklist).toEqual(checklist);
    expect(rows[0]?.executionRevision).toBe(1);
    expect(rows[0]?.canComplete).toBe(true);
  });

  it("serializes competing draft revisions so only one edit wins", async () => {
    const { studentId, itemId } = await seed();
    const common = {
      actorId: studentId,
      actorRole: "student" as const,
      scheduleItemId: itemId,
      expectedRevision: 0,
      now,
    };
    const outcomes = await Promise.allSettled([
      updateTaskExecution(db, { ...common, idempotencyKey: "a", checklist }),
      updateTaskExecution(db, {
        ...common,
        idempotencyKey: "b",
        checklist: [{ ...checklist[0]!, completed: false }],
      }),
    ]);
    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === "rejected")).toHaveLength(1);
  });

  it("keeps immutable completion snapshots and reverses/resettles repeated corrections including negative rewards", async () => {
    const { parentId, studentId, itemId } = await seed();
    await updateTaskExecution(db, {
      actorId: studentId,
      actorRole: "student",
      scheduleItemId: itemId,
      idempotencyKey: "draft",
      expectedRevision: 0,
      checklist,
      now,
    });
    const done = await completeScheduleItem(db, {
      actorId: studentId,
      scheduleItemId: itemId,
      idempotencyKey: "complete",
      body: { startedAt: "2026-01-15T10:00:00Z", completedAt: "2026-01-15T10:20:00Z" },
      now: new Date("2026-01-15T10:20:00Z"),
    });
    const original = (
      await db.select().from(factVersions).where(eq(factVersions.id, done.factVersionId))
    )[0]!;
    expect(original.value.execution).toMatchObject({ revision: 2, checklist, all_completed: true });
    expect(await balance(studentId)).toBe(10);
    const correction = {
      actorId: parentId,
      actorRole: "parent" as const,
      scheduleItemId: itemId,
      idempotencyKey: "correct",
      expectedRevision: 2,
      checklist: [{ ...checklist[0]!, completed: false }],
      startedAt: "2026-01-15T10:01:00Z",
      completedAt: "2026-01-15T10:25:00Z",
      reason: "更正实际记录",
      correction: true,
      now: new Date("2026-01-16T10:00:00Z"),
    };
    const changed = await updateTaskExecution(db, correction);
    expect(changed.predecessorFactId).toBe(original.id);
    expect(changed.reversalLedgerEntryIds).toHaveLength(1);
    expect(await balance(studentId)).toBe(-2);
    expect(
      (await db.select().from(factVersions).where(eq(factVersions.id, original.id)))[0],
    ).toEqual(original);
    expect((await updateTaskExecution(db, correction)).idempotentReplay).toBe(true);
    expect(await balance(studentId)).toBe(-2);
    await updateTaskExecution(db, {
      ...correction,
      idempotencyKey: "recorrect",
      expectedRevision: 3,
      checklist,
    });
    expect(await balance(studentId)).toBe(10);
    const rows = await queryScheduleItems(db, {
      studentId,
      actorId: parentId,
      actorRole: "parent",
      from: "2026-01-15",
      to: "2026-01-15",
      now: correction.now,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      pointsEarned: 10,
      executionRevision: 4,
      canCorrect: true,
      actualDurationMinutes: 24,
    });
    expect(rows[0]?.startedAt?.toISOString()).toBe("2026-01-15T10:01:00.000Z");
  });

  it("keeps legacy completion corrections on rule A10 after active version B20 replaces it", async () => {
    const { parentId, studentId, itemId, rule } = await seedLegacyCompletion();
    expect(await balance(studentId)).toBe(10);
    expect(
      await db.select().from(planItemRules).where(eq(planItemRules.scheduleItemId, itemId)),
    ).toHaveLength(0);
    const [versionA] = await db
      .select()
      .from(pointRuleVersions)
      .where(eq(pointRuleVersions.id, rule.ruleVersionId));
    if (!versionA) throw new Error("Missing original rule");
    await db
      .update(pointRuleVersions)
      .set({ status: "superseded" })
      .where(eq(pointRuleVersions.id, versionA.id));
    const [versionB] = await db
      .insert(pointRuleVersions)
      .values({
        pointRuleId: rule.ruleId,
        version: 2,
        parameters: versionA.parameters,
        effect: { amount: 20, rewardsLateCompletion: false },
        effectiveAt: new Date("2026-01-15T11:00:00Z"),
        status: "active",
      })
      .returning({ id: pointRuleVersions.id });
    const correction = {
      actorId: parentId,
      actorRole: "parent" as const,
      scheduleItemId: itemId,
      expectedRevision: 1,
      idempotencyKey: "legacy-correct",
      reason: "更正实际执行时间",
      startedAt: "2026-01-15T09:30:00Z",
      completedAt: "2026-01-15T10:00:00Z",
      correction: true,
      now: new Date("2026-01-16T10:00:00Z"),
    };
    await updateTaskExecution(db, correction);
    expect(await balance(studentId)).toBe(10);
    await updateTaskExecution(db, {
      ...correction,
      expectedRevision: 2,
      idempotencyKey: "legacy-recorrect",
    });
    expect(await balance(studentId)).toBe(10);
    const rewards = await db
      .select()
      .from(settlements)
      .where(and(eq(settlements.studentId, studentId), eq(settlements.result, "reward")));
    expect(rewards).toHaveLength(3);
    expect(rewards.every((settlement) => settlement.ruleVersionId === versionA.id)).toBe(true);
    const amounts = await db
      .select({ amount: pointLedgerEntries.amount })
      .from(pointLedgerEntries)
      .where(eq(pointLedgerEntries.studentId, studentId));
    expect(amounts.map((entry) => entry.amount).sort((a, b) => a - b)).toEqual([
      -10, -10, 10, 10, 10,
    ]);
    expect(
      (await db.select().from(pointRuleVersions).where(eq(pointRuleVersions.id, versionB!.id)))[0]
        ?.status,
    ).toBe("active");
  });

  it("rolls back legacy correction when its historical settlement is missing instead of using the active rule", async () => {
    const { parentId, studentId, itemId, done } = await seedLegacyCompletion(true);
    await expect(
      updateTaskExecution(db, {
        actorId: parentId,
        actorRole: "parent",
        scheduleItemId: itemId,
        expectedRevision: 1,
        idempotencyKey: "legacy-missing-settlement",
        reason: "更正缺少结算的记录",
        correction: true,
        now: new Date("2026-01-16T10:00:00Z"),
      }),
    ).rejects.toMatchObject({ code: "STATE_CONFLICT" });
    const facts = await db
      .select()
      .from(factVersions)
      .where(eq(factVersions.scheduleItemId, itemId));
    expect(facts).toHaveLength(1);
    expect(facts[0]?.id).toBe(done.factVersionId);
    expect(
      (
        await db
          .select()
          .from(scheduleTaskExecutions)
          .where(eq(scheduleTaskExecutions.scheduleItemId, itemId))
      )[0]?.revision,
    ).toBe(1);
    expect(
      await db.select().from(settlements).where(eq(settlements.studentId, studentId)),
    ).toHaveLength(0);
    expect(
      await db.select().from(pointLedgerEntries).where(eq(pointLedgerEntries.studentId, studentId)),
    ).toHaveLength(0);
    expect(await balance(studentId)).toBe(0);
  });

  it("enforces student same-day and parent day60 correction boundaries", async () => {
    const { parentId, studentId, itemId } = await seed();
    await completeScheduleItem(db, {
      actorId: studentId,
      scheduleItemId: itemId,
      idempotencyKey: "done",
      now,
    });
    const input = {
      scheduleItemId: itemId,
      expectedRevision: 1,
      checklist: [],
      idempotencyKey: "edit",
      reason: "记录更正",
      correction: true,
    };
    await expect(
      updateTaskExecution(db, {
        ...input,
        actorId: studentId,
        actorRole: "student",
        now: new Date("2026-01-15T16:00:00Z"),
      }),
    ).rejects.toMatchObject({ code: "WINDOW_EXPIRED" });
    const allowed = await updateTaskExecution(db, {
      ...input,
      actorId: parentId,
      actorRole: "parent",
      now: new Date("2026-03-16T15:59:59Z"),
    });
    expect(allowed.revision).toBe(2);
    await expect(
      updateTaskExecution(db, {
        ...input,
        idempotencyKey: "late",
        expectedRevision: 2,
        actorId: parentId,
        actorRole: "parent",
        now: new Date("2026-03-16T16:00:00Z"),
      }),
    ).rejects.toMatchObject({ code: "WINDOW_EXPIRED" });
  });

  it("blocks unrelated edits and future starts, and projects expiry at22:00", async () => {
    const { studentId, itemId } = await seed({ date: "2026-01-16" });
    await expect(
      startPlanItem(db, {
        actorId: studentId,
        scheduleItemId: itemId,
        idempotencyKey: "early",
        now,
      }),
    ).rejects.toMatchObject({ code: "WINDOW_EXPIRED" });
    const { studentId: otherId } = await bootstrapParentStudentRelationship(db);
    await expect(
      updateTaskExecution(db, {
        actorId: otherId,
        actorRole: "student",
        scheduleItemId: itemId,
        expectedRevision: 0,
        checklist,
        idempotencyKey: "other",
        now,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const deadline = new Date("2026-01-17T14:00:00Z");
    expect(
      (
        await queryScheduleItems(db, {
          studentId,
          from: "2026-01-16",
          to: "2026-01-16",
          now: deadline,
        })
      )[0],
    ).toMatchObject({
      effectiveStatus: "expired",
      canStart: false,
      canComplete: false,
      canEditExecution: false,
    });
    await expect(
      startPlanItem(db, {
        actorId: studentId,
        scheduleItemId: itemId,
        idempotencyKey: "expired",
        now: deadline,
      }),
    ).rejects.toMatchObject({ code: "WINDOW_EXPIRED" });
    await db.transaction(async (tx) => {
      expect(
        await persistExpiredPastWindow(tx, studentId, deadline, {
          limit: 1,
          scheduleItemIds: [itemId],
        }),
      ).toBe(1);
    });
    const fact = await db
      .select()
      .from(factVersions)
      .where(eq(factVersions.scheduleItemId, itemId));
    expect(fact[0]?.factKey).toBe("schedule.incomplete");
  });

  it("finishes homework timers at completion and makes pause retries idempotent", async () => {
    const { studentId, itemId } = await seed();
    const common = { actorId: studentId, actorRole: "student" as const, scheduleItemId: itemId };
    await updateTaskExecution(db, {
      ...common,
      expectedRevision: 0,
      checklist: [{ ...checklist[0]!, completed: false }],
      idempotencyKey: "draft",
      now,
    });
    await updateTaskExecution(db, {
      ...common,
      expectedRevision: 1,
      subtaskId: "math",
      pomodoroAction: "start",
      idempotencyKey: "start",
      now,
    });
    const pause = {
      ...common,
      expectedRevision: 2,
      subtaskId: "math",
      pomodoroAction: "pause" as const,
      idempotencyKey: "pause",
      now: new Date("2026-01-15T10:05:00Z"),
    };
    await updateTaskExecution(db, pause);
    expect((await updateTaskExecution(db, pause)).idempotentReplay).toBe(true);
    const [execution] = await db
      .select()
      .from(scheduleTaskExecutions)
      .where(eq(scheduleTaskExecutions.scheduleItemId, itemId));
    const saved = execution!.checklist.map((task) => ({
      ...task,
      completed: true,
    })) as typeof checklist;
    await updateTaskExecution(db, {
      ...common,
      expectedRevision: 3,
      checklist: saved,
      idempotencyKey: "checked",
      now: pause.now,
    });
    await completeScheduleItem(db, {
      actorId: studentId,
      scheduleItemId: itemId,
      idempotencyKey: "done",
      now: new Date("2026-01-15T10:10:00Z"),
    });
    const items = await queryScheduleItems(db, {
      studentId,
      from: "2026-01-15",
      to: "2026-01-15",
      now: new Date("2026-01-15T10:10:00Z"),
    });
    expect(items[0]?.checklist[0]?.pomodoro).toMatchObject({
      state: "stopped",
      pauseCount: 1,
      pausedSeconds: 300,
      focusedSeconds: 300,
    });
  });

  it("permits a next-day start and manual completion before22:00", async () => {
    const { studentId, itemId } = await seed();
    await startPlanItem(db, {
      actorId: studentId,
      scheduleItemId: itemId,
      idempotencyKey: "late-start",
      now: new Date("2026-01-16T12:00:00Z"),
    });
    await completeScheduleItem(db, {
      actorId: studentId,
      scheduleItemId: itemId,
      idempotencyKey: "late-done",
      body: { completedAt: "2026-01-16T12:20:00Z" },
      now: new Date("2026-01-16T12:20:00Z"),
    });
    const [item] = await queryScheduleItems(db, {
      studentId,
      from: "2026-01-15",
      to: "2026-01-15",
      now: new Date("2026-01-16T12:20:00Z"),
    });
    expect(item?.startedAt?.toISOString()).toBe("2026-01-16T12:00:00.000Z");
    expect(item?.actualDurationMinutes).toBe(20);
    expect(item?.effectiveStatus).toBe("completed");
  });

  it("coexists equal top priorities while suppressing only strictly lower work", async () => {
    const { parentId, studentId, definition } = await seed({ priority: 10 });
    for (const priority of [10, 5]) {
      const saved = await createPlanLibrary(db, {
        ownerId: parentId,
        definition,
        priority,
        idempotencyKey: `save-${priority}`,
      });
      await activatePlanLibrary(db, {
        ownerId: parentId,
        studentId,
        libraryId: saved.id,
        effectiveFrom: "2026-01-15",
        idempotencyKey: `activate-${priority}`,
        now,
      });
    }
    const rows = await queryScheduleItems(db, {
      studentId,
      from: "2026-01-15",
      to: "2026-01-15",
      now,
    });
    expect(
      rows
        .filter((item) => item.priority === 10)
        .every((item) => item.suppressedByScheduleItemId === null && item.canComplete),
    ).toBe(true);
    expect(rows.find((item) => item.priority === 5)).toMatchObject({
      canStart: false,
      canComplete: false,
      canEditExecution: false,
    });
    const [low] = rows.filter((item) => item.priority === 5);
    await expect(
      completeScheduleItem(db, {
        actorId: studentId,
        scheduleItemId: low!.id,
        idempotencyKey: "suppressed",
        now,
      }),
    ).rejects.toMatchObject({ code: "STATE_CONFLICT" });
  });

  it("replays activation without creating a second occurrence and restores covered work when removed", async () => {
    const { parentId, studentId, definition, itemId } = await seed({ priority: 5 });
    const high = await createPlanLibrary(db, {
      ownerId: parentId,
      definition,
      priority: 10,
      idempotencyKey: "high",
    });
    const request = {
      ownerId: parentId,
      studentId,
      libraryId: high.id,
      effectiveFrom: "2026-01-15",
      idempotencyKey: "activate-high",
      now,
    };
    const first = await activatePlanLibrary(db, request);
    expect(await activatePlanLibrary(db, request)).toEqual({ ...first, idempotentReplay: true });
    expect(
      await db.select().from(scheduleItems).where(eq(scheduleItems.planId, first.planId)),
    ).toHaveLength(1);
    await expect(
      activatePlanLibrary(db, { ...request, effectiveFrom: "2026-01-16" }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await removePlanLibraryBinding(db, {
      ownerId: parentId,
      studentId,
      libraryId: high.id,
      idempotencyKey: "remove-high",
      now,
    });
    expect(
      (await queryScheduleItems(db, { studentId, from: "2026-01-15", to: "2026-01-15", now })).find(
        (item) => item.id === itemId,
      ),
    ).toMatchObject({ suppressedByScheduleItemId: null, canComplete: true });
  });

  for (const owner of ["student", "parent"] as const)
    it(`credits new ${owner} personal plans to that owner's own balance`, async () => {
      const { studentId, ownerId, itemId } = await seed({ owner, self: true });
      expect(studentId).toBe(ownerId);
      const [frozen] = await db
        .select()
        .from(planItemRules)
        .where(eq(planItemRules.scheduleItemId, itemId));
      expect(frozen?.entry.points).toEqual(points);
      await completeScheduleItem(db, {
        actorId: ownerId,
        actorRole: owner,
        scheduleItemId: itemId,
        idempotencyKey: "done",
        body: { startedAt: "2026-01-15T09:40:00Z", completedAt: "2026-01-15T10:00:00Z" },
        now,
      });
      expect(await balance(ownerId)).toBe(10);
      expect(
        (
          await db
            .select()
            .from(pointLedgerEntries)
            .where(
              and(eq(pointLedgerEntries.studentId, ownerId), eq(pointLedgerEntries.amount, 10)),
            )
        ).length,
      ).toBe(1);
    });
});
