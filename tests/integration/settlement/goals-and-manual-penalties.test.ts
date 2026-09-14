import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { families, pointBalanceProjection, relationships, users } from "@/db/schema";
import { addGoalNote, approveGoal, createGoals, evaluateGoal, listGoals, updateGoal } from "@/modules/goals/goal.service";
import { createManualPenalty, listManualPenalties, reverseManualPenalty } from "@/modules/settlement/manual-points.service";
import { closeIsolatedM2Database, openIsolatedM2Database, type IsolatedM2Database } from "../migrations/m2-isolated-database";

config({ path: ".env.local" });
config({ path: ".env" });

const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("goals and manual penalties", () => {
  let isolated: IsolatedM2Database;

  beforeAll(async () => { isolated = await openIsolatedM2Database(); });
  afterAll(async () => { if (isolated) await closeIsolatedM2Database(isolated); });

  it("locks goal responsibility and keeps penalties/reversals in the immutable balance chain", async () => {
    const db = isolated.db;
    const [parentOne, parentTwo, student] = await db.insert(users).values([
      { role: "parent", displayName: "家长甲", email: "parent-one@goal.test", passwordHash: "test", contactVerifiedAt: new Date(), status: "active" },
      { role: "parent", displayName: "家长乙", email: "parent-two@goal.test", passwordHash: "test", contactVerifiedAt: new Date(), status: "active" },
      { role: "student", displayName: "学生", username: "goal_student", passwordHash: "test", status: "active", mustChangePassword: false },
    ]).returning({ id: users.id });
    const [family] = await db.insert(families).values({}).returning({ id: families.id });
    await db.insert(relationships).values([
      { familyId: family!.id, parentId: parentOne!.id, studentId: student!.id, acceptedAt: new Date() },
      { familyId: family!.id, parentId: parentTwo!.id, studentId: student!.id, acceptedAt: new Date() },
    ]);
    await db.insert(pointBalanceProjection).values({ studentId: student!.id, balance: 10, updatedAt: new Date() });

    const proposed = await createGoals(db, { actorId: student!.id, content: "完成阅读目标", dueDate: "2026-09-30", expectedPoints: 7, expectedGift: "一本书", idempotencyKey: "goal-propose" });
    const assignmentId = proposed.assignmentIds[0]!;
    const proposal = (await listGoals(db, student!.id)).find((goal) => goal.assignmentId === assignmentId)!;
    await updateGoal(db, { actorId: student!.id, assignmentId, revision: proposal.revision, content: "完成一周阅读目标", dueDate: "2026-09-30", expectedPoints: 7, expectedGift: "一本书", idempotencyKey: "goal-proposal-edit" });
    await approveGoal(db, { actorId: parentOne!.id, assignmentId, idempotencyKey: "goal-approve" });
    await expect(evaluateGoal(db, { actorId: parentTwo!.id, assignmentId, outcome: "succeeded", actualPoints: 7, actualGift: "一本书", idempotencyKey: "wrong-parent" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await evaluateGoal(db, { actorId: parentOne!.id, assignmentId, outcome: "succeeded", actualPoints: 7, actualGift: "一本书", idempotencyKey: "goal-evaluate" });
    expect((await listGoals(db, student!.id))[0]).toMatchObject({ status: "succeeded", actualPoints: 7, responsibleParentId: parentOne!.id });
    await expect(addGoalNote(db, { actorId: parentTwo!.id, assignmentId, body: "无权补充", idempotencyKey: "wrong-note-parent" })).rejects.toMatchObject({ code: "FORBIDDEN" });

    const penalty = await createManualPenalty(db, { actorParentId: parentTwo!.id, studentId: student!.id, points: 4, reason: "未按约定整理书桌", idempotencyKey: "penalty" });
    expect(penalty.amount).toBe(-4);
    await expect(reverseManualPenalty(db, { actorParentId: parentOne!.id, studentId: student!.id, adjustmentId: penalty.adjustmentId, reason: "尝试撤销", idempotencyKey: "wrong-reversal" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await reverseManualPenalty(db, { actorParentId: parentTwo!.id, studentId: student!.id, adjustmentId: penalty.adjustmentId, reason: "确认误扣，完整撤销", idempotencyKey: "reversal" });
    const visible = await listManualPenalties(db, { actorId: student!.id, actorRole: "student", studentId: student!.id });
    expect(visible.map((item) => item.amount)).toEqual([4, -4]);
    expect(visible.find((item) => item.id === penalty.adjustmentId)?.canReverse).toBe(false);
    const [balance] = await db.select().from(pointBalanceProjection).where(eq(pointBalanceProjection.studentId, student!.id));
    expect(balance?.balance).toBe(17);
  });

  it("edits an unevaluated goal and only appends notes after evaluation", async () => {
    const db = isolated.db;
    const [parent, student] = await db.insert(users).values([
      { role: "parent", displayName: "目标家长", email: "goal-edit-parent@test.local", passwordHash: "test", contactVerifiedAt: new Date(), status: "active" },
      { role: "student", displayName: "目标学生", username: "goal_edit_student", passwordHash: "test", status: "active", mustChangePassword: false },
    ]).returning({ id: users.id });
    const [family] = await db.insert(families).values({}).returning({ id: families.id });
    await db.insert(relationships).values({ familyId: family!.id, parentId: parent!.id, studentId: student!.id, acceptedAt: new Date() });

    const created = await createGoals(db, { actorId: parent!.id, subjectIds: [student!.id], content: "旧目标", dueDate: "2026-09-30", idempotencyKey: "editable-goal" });
    const assignmentId = created.assignmentIds[0]!;
    const before = (await listGoals(db, parent!.id)).find((goal) => goal.assignmentId === assignmentId)!;
    await updateGoal(db, { actorId: parent!.id, assignmentId, revision: before.revision, content: "新目标", dueDate: "2026-10-01", expectedPoints: 8, expectedGift: "新礼物", notes: "新备注", idempotencyKey: "update-goal" });
    expect((await listGoals(db, parent!.id)).find((goal) => goal.assignmentId === assignmentId)).toMatchObject({ content: "新目标", revision: before.revision + 1, canEdit: true });

    await evaluateGoal(db, { actorId: parent!.id, assignmentId, outcome: "succeeded", actualPoints: 8, actualGift: "新礼物", idempotencyKey: "evaluate-edited-goal" });
    await expect(updateGoal(db, { actorId: parent!.id, assignmentId, revision: before.revision + 1, content: "不能覆盖", dueDate: "2026-10-02", idempotencyKey: "update-terminal-goal" })).rejects.toMatchObject({ code: "STATE_CONFLICT" });
    await addGoalNote(db, { actorId: parent!.id, assignmentId, body: "评定后的补充说明", idempotencyKey: "terminal-note" });
    const terminal = (await listGoals(db, parent!.id)).find((goal) => goal.assignmentId === assignmentId)!;
    expect(terminal.postNotes).toHaveLength(1);
    expect(terminal.postNotes[0]).toMatchObject({ authorName: "目标家长", body: "评定后的补充说明" });
  });
});
