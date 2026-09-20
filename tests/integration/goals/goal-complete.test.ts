import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { auditEvents, families, goalAssignments, outboxEvents, relationships, users } from "@/db/schema";
import { completeGoal, createGoals, evaluateGoal, listGoals } from "@/modules/goals/goal.service";
import { closeIsolatedM2Database, openIsolatedM2Database, type IsolatedM2Database } from "../migrations/m2-isolated-database";

config({ path: ".env.local" });
config({ path: ".env" });

const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("goal complete state machine", () => {
  let isolated: IsolatedM2Database;

  beforeAll(async () => {
    isolated = await openIsolatedM2Database();
  });
  afterAll(async () => {
    if (isolated) await closeIsolatedM2Database(isolated);
  });

  async function seedStudentParent() {
    const db = isolated.db;
    const [parent, student, otherStudent] = await db
      .insert(users)
      .values([
        {
          role: "parent",
          displayName: "责任家长",
          email: `complete-parent-${crypto.randomUUID()}@test.local`,
          passwordHash: "test",
          contactVerifiedAt: new Date(),
          status: "active",
        },
        {
          role: "student",
          displayName: "目标学生",
          username: `complete_student_${crypto.randomUUID().slice(0, 8)}`,
          passwordHash: "test",
          status: "active",
          mustChangePassword: false,
        },
        {
          role: "student",
          displayName: "其他学生",
          username: `complete_other_${crypto.randomUUID().slice(0, 8)}`,
          passwordHash: "test",
          status: "active",
          mustChangePassword: false,
        },
      ])
      .returning({ id: users.id });
    const [family] = await db.insert(families).values({}).returning({ id: families.id });
    await db.insert(relationships).values({
      familyId: family!.id,
      parentId: parent!.id,
      studentId: student!.id,
      acceptedAt: new Date(),
    });
    const created = await createGoals(db, {
      actorId: parent!.id,
      subjectIds: [student!.id],
      content: "完成阅读",
      dueDate: "2026-12-01",
      horizon: "medium",
      idempotencyKey: "seed-goal",
    });
    return { db, parent: parent!, student: student!, otherStudent: otherStudent!, assignmentId: created.assignmentIds[0]! };
  }

  it("allows subject completion with idempotent replay and blocks other actors", async () => {
    const { db, parent, student, otherStudent, assignmentId } = await seedStudentParent();
    await expect(
      completeGoal(db, { actorId: parent.id, assignmentId, idempotencyKey: "parent-complete" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      completeGoal(db, { actorId: otherStudent.id, assignmentId, idempotencyKey: "other-complete" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const first = await completeGoal(db, {
      actorId: student.id,
      assignmentId,
      idempotencyKey: "student-complete",
    });
    const replay = await completeGoal(db, {
      actorId: student.id,
      assignmentId,
      idempotencyKey: "student-complete",
    });
    expect(replay).toEqual(first);

    const listed = (await listGoals(db, student.id)).find((g) => g.assignmentId === assignmentId)!;
    expect(listed.status).toBe("completed");
    expect(listed.canEvaluate).toBe(false);
    expect((await listGoals(db, parent.id)).find((g) => g.assignmentId === assignmentId)?.canEvaluate).toBe(
      true,
    );

    const audits = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "goal.completed"));
    expect(audits.filter((row) => row.resourceId === assignmentId)).toHaveLength(1);
    const outbox = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.eventType, "goal.completed"));
    expect(outbox.filter((row) => row.aggregateId === assignmentId)).toHaveLength(1);
  });

  it("requires completed before evaluation and preserves ledger on evaluate", async () => {
    const { db, parent, student, assignmentId } = await seedStudentParent();
    await expect(
      evaluateGoal(db, {
        actorId: parent.id,
        assignmentId,
        outcome: "succeeded",
        actualPoints: 3,
        idempotencyKey: "early-eval",
      }),
    ).rejects.toMatchObject({ code: "STATE_CONFLICT" });

    await completeGoal(db, { actorId: student.id, assignmentId, idempotencyKey: "complete-before-eval" });
    const evaluated = await evaluateGoal(db, {
      actorId: parent.id,
      assignmentId,
      outcome: "succeeded",
      actualPoints: 0,
      idempotencyKey: "eval-after-complete",
    });
    expect(evaluated.status).toBe("succeeded");
    const [row] = await db.select().from(goalAssignments).where(eq(goalAssignments.id, assignmentId));
    expect(row?.completedBy).toBe(student.id);
    expect(row?.completedAt).toBeTruthy();
    expect(row?.evaluatedBy).toBe(parent.id);
  });

  it("rejects completion when assignment is not active", async () => {
    const { db, student, assignmentId } = await seedStudentParent();
    await db
      .update(goalAssignments)
      .set({ status: "pending_approval" })
      .where(eq(goalAssignments.id, assignmentId));
    await expect(
      completeGoal(db, { actorId: student.id, assignmentId, idempotencyKey: "pending-complete" }),
    ).rejects.toMatchObject({ code: "STATE_CONFLICT" });
  });

  it("rejects idempotency key reuse across different assignments", async () => {
    const { db, parent, student, assignmentId } = await seedStudentParent();
    const second = await createGoals(db, {
      actorId: parent.id,
      subjectIds: [student.id],
      content: "第二个目标",
      dueDate: "2026-12-02",
      horizon: "short",
      idempotencyKey: "second-goal",
    });
    await completeGoal(db, {
      actorId: student.id,
      assignmentId,
      idempotencyKey: "shared-complete-key",
    });
    await expect(
      completeGoal(db, {
        actorId: student.id,
        assignmentId: second.assignmentIds[0]!,
        idempotencyKey: "shared-complete-key",
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("allows only one concurrent completion to succeed", async () => {
    const { db, student, assignmentId } = await seedStudentParent();
    const results = await Promise.allSettled([
      completeGoal(db, {
        actorId: student.id,
        assignmentId,
        idempotencyKey: "race-a",
      }),
      completeGoal(db, {
        actorId: student.id,
        assignmentId,
        idempotencyKey: "race-b",
      }),
    ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const [row] = await db
      .select({ status: goalAssignments.status })
      .from(goalAssignments)
      .where(eq(goalAssignments.id, assignmentId));
    expect(row?.status).toBe("completed");
  });

  it("blocks evaluation racing ahead of completion", async () => {
    const { db, parent, student, assignmentId } = await seedStudentParent();
    await expect(
      evaluateGoal(db, {
        actorId: parent.id,
        assignmentId,
        outcome: "succeeded",
        actualPoints: 1,
        idempotencyKey: "eval-race",
      }),
    ).rejects.toMatchObject({ code: "STATE_CONFLICT" });
    await completeGoal(db, {
      actorId: student.id,
      assignmentId,
      idempotencyKey: "complete-race",
    });
    const evaluated = await evaluateGoal(db, {
      actorId: parent.id,
      assignmentId,
      outcome: "succeeded",
      actualPoints: 0,
      idempotencyKey: "eval-after-race",
    });
    expect(evaluated.status).toBe("succeeded");
  });
});
