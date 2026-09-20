import { config } from "dotenv";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { auditEvents, families, goalGiftRedemptions, outboxEvents, relationships, users } from "@/db/schema";
import {
  completeGoal,
  createGoals,
  evaluateGoal,
  listGoals,
  recordGoalGiftRedemption,
} from "@/modules/goals/goal.service";
import {
  closeIsolatedM2Database,
  openIsolatedM2Database,
  type IsolatedM2Database,
} from "../migrations/m2-isolated-database";

config({ path: ".env.local" });
config({ path: ".env" });

const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("goal horizon and gift redemption", () => {
  let isolated: IsolatedM2Database;

  beforeAll(async () => {
    isolated = await openIsolatedM2Database();
  });
  afterAll(async () => {
    if (isolated) await closeIsolatedM2Database(isolated);
  });

  it("creates/lists horizon and records an immutable gift redemption once", async () => {
    const db = isolated.db;
    const [parent, otherParent, student] = await db
      .insert(users)
      .values([
        {
          role: "parent",
          displayName: "责任家长",
          email: "gift-parent@goal.test",
          passwordHash: "test",
          contactVerifiedAt: new Date(),
          status: "active",
        },
        {
          role: "parent",
          displayName: "其他家长",
          email: "other-parent@goal.test",
          passwordHash: "test",
          contactVerifiedAt: new Date(),
          status: "active",
        },
        {
          role: "student",
          displayName: "学生",
          username: "gift_student",
          passwordHash: "test",
          status: "active",
          mustChangePassword: false,
        },
      ])
      .returning({ id: users.id });
    const [family] = await db.insert(families).values({}).returning({ id: families.id });
    await db.insert(relationships).values([
      { familyId: family!.id, parentId: parent!.id, studentId: student!.id, acceptedAt: new Date() },
      {
        familyId: family!.id,
        parentId: otherParent!.id,
        studentId: student!.id,
        acceptedAt: new Date(),
      },
    ]);

    await expect(
      createGoals(db, {
        actorId: parent!.id,
        subjectIds: [student!.id],
        content: "缺少期限",
        dueDate: "2026-10-01",
        idempotencyKey: "missing-horizon",
      } as never),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    const created = await createGoals(db, {
      actorId: parent!.id,
      subjectIds: [student!.id],
      content: "完成科学小报",
      dueDate: "2026-10-01",
      expectedPoints: 5,
      expectedGift: "博物馆门票",
      horizon: "short",
      idempotencyKey: "goal-with-horizon",
    });
    const assignmentId = created.assignmentIds[0]!;
    const listed = (await listGoals(db, parent!.id)).find((goal) => goal.assignmentId === assignmentId)!;
    expect(listed).toMatchObject({
      horizon: "short",
      giftRedeemedAt: null,
      canRecordGiftRedemption: false,
      status: "active",
    });

    await completeGoal(db, { actorId: student!.id, assignmentId, idempotencyKey: "complete-gift-goal" });
    await evaluateGoal(db, {
      actorId: parent!.id,
      assignmentId,
      outcome: "succeeded",
      actualPoints: 5,
      actualGift: "博物馆门票",
      idempotencyKey: "evaluate-gift-goal",
    });

    const succeeded = (await listGoals(db, parent!.id)).find((goal) => goal.assignmentId === assignmentId)!;
    expect(succeeded).toMatchObject({
      status: "succeeded",
      actualGift: "博物馆门票",
      canRecordGiftRedemption: true,
      giftRedeemedAt: null,
    });

    await expect(
      recordGoalGiftRedemption(db, {
        actorId: otherParent!.id,
        assignmentId,
        redeemedAt: "2026-09-15T10:00:00.000+08:00",
        idempotencyKey: "wrong-parent-redeem",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await expect(
      recordGoalGiftRedemption(db, {
        actorId: parent!.id,
        assignmentId,
        redeemedAt: "not-a-date",
        idempotencyKey: "bad-time",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    await expect(
      recordGoalGiftRedemption(db, {
        actorId: parent!.id,
        assignmentId,
        redeemedAt: new Date(Date.now() + 60_000).toISOString(),
        idempotencyKey: "future-time",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    const redeemedAt = "2026-09-15T12:30:00.000+08:00";
    const first = await recordGoalGiftRedemption(db, {
      actorId: parent!.id,
      assignmentId,
      redeemedAt,
      idempotencyKey: "redeem-once",
    });
    const replay = await recordGoalGiftRedemption(db, {
      actorId: parent!.id,
      assignmentId,
      redeemedAt,
      idempotencyKey: "redeem-once",
    });
    expect(replay).toEqual(first);

    await expect(
      recordGoalGiftRedemption(db, {
        actorId: parent!.id,
        assignmentId,
        redeemedAt: "2026-09-15T13:00:00.000+08:00",
        idempotencyKey: "redeem-once",
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    const after = (await listGoals(db, parent!.id)).find((goal) => goal.assignmentId === assignmentId)!;
    expect(after.giftRedeemedAt).toBe(new Date(redeemedAt).toISOString());
    expect(after.canRecordGiftRedemption).toBe(false);

    const facts = await db
      .select()
      .from(goalGiftRedemptions)
      .where(eq(goalGiftRedemptions.assignmentId, assignmentId));
    expect(facts).toHaveLength(1);

    const audits = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.action, "goal.gift_redeemed"), eq(auditEvents.resourceId, assignmentId)));
    expect(audits.length).toBeGreaterThanOrEqual(1);

    const outbox = await db
      .select()
      .from(outboxEvents)
      .where(and(eq(outboxEvents.eventType, "goal.gift_redeemed"), eq(outboxEvents.aggregateId, assignmentId)));
    expect(outbox.length).toBeGreaterThanOrEqual(1);
  });

  it("rejects redemption when goal is not succeeded or has no actual gift", async () => {
    const db = isolated.db;
    const [parent, student] = await db
      .insert(users)
      .values([
        {
          role: "parent",
          displayName: "冲突家长",
          email: "conflict-parent@goal.test",
          passwordHash: "test",
          contactVerifiedAt: new Date(),
          status: "active",
        },
        {
          role: "student",
          displayName: "冲突学生",
          username: "conflict_student",
          passwordHash: "test",
          status: "active",
          mustChangePassword: false,
        },
      ])
      .returning({ id: users.id });
    const [family] = await db.insert(families).values({}).returning({ id: families.id });
    await db
      .insert(relationships)
      .values({ familyId: family!.id, parentId: parent!.id, studentId: student!.id, acceptedAt: new Date() });

    const active = await createGoals(db, {
      actorId: parent!.id,
      subjectIds: [student!.id],
      content: "未达成目标",
      dueDate: "2026-10-02",
      expectedGift: "贴纸",
      horizon: "medium",
      idempotencyKey: "active-goal",
    });
    await expect(
      recordGoalGiftRedemption(db, {
        actorId: parent!.id,
        assignmentId: active.assignmentIds[0]!,
        redeemedAt: "2026-09-15T12:00:00.000+08:00",
        idempotencyKey: "redeem-active",
      }),
    ).rejects.toMatchObject({ code: "STATE_CONFLICT" });

    const noGift = await createGoals(db, {
      actorId: parent!.id,
      subjectIds: [student!.id],
      content: "无礼物目标",
      dueDate: "2026-10-03",
      horizon: "long",
      idempotencyKey: "no-gift-goal",
    });
    await completeGoal(db, {
      actorId: student!.id,
      assignmentId: noGift.assignmentIds[0]!,
      idempotencyKey: "complete-no-gift",
    });
    await evaluateGoal(db, {
      actorId: parent!.id,
      assignmentId: noGift.assignmentIds[0]!,
      outcome: "succeeded",
      actualPoints: 0,
      actualGift: null,
      idempotencyKey: "evaluate-no-gift",
    });
    await expect(
      recordGoalGiftRedemption(db, {
        actorId: parent!.id,
        assignmentId: noGift.assignmentIds[0]!,
        redeemedAt: "2026-09-15T12:00:00.000+08:00",
        idempotencyKey: "redeem-no-gift",
      }),
    ).rejects.toMatchObject({ code: "STATE_CONFLICT" });
  });
});
