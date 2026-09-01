import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { users } from "@/db/schema";
import { DataLifecycleError } from "@/modules/data-lifecycle/errors";
import { DELETION_TARGET_TYPE } from "@/modules/data-lifecycle/constants";
import { createDeletionRequest } from "@/modules/data-lifecycle/deletion-request.service";
import { endRelationship } from "@/modules/family-access/end-relationship.service";
import { login, validateSession } from "@/modules/identity/login.service";
import { createLucia } from "@/lib/lucia";
import { listCatalogItems } from "@/modules/redemption/catalog.service";
import { listRedemptions } from "@/modules/redemption/redemption.service";
import { completeScheduleItem } from "@/modules/schedule/complete-schedule.service";
import { createFormalPlan } from "@/modules/schedule/plan.service";
import { queryScheduleItems } from "@/modules/schedule/schedule-query.service";
import { getDailyReflection } from "@/modules/reflection-privacy/get-daily-reflection.service";
import { upsertDailyReflection } from "@/modules/reflection-privacy/upsert-daily-reflection.service";
import {
  enablePointRule,
  SCHEDULE_SYSTEM_COMPLETE_V1,
} from "@/modules/settlement/point-rule.service";
import { queryPointsBalance, queryPointsLedger } from "@/modules/settlement/ledger.service";
import {
  getTrainingSessionForStudent,
  getTrainingSummaryForParent,
  startTrainingSession,
  submitTrainingSession,
} from "@/modules/training/session.service";
import { queryTrainingTrends } from "@/modules/training/trends.service";
import { toFamilyDate } from "@/modules/time-policy/to-family-date";
import {
  acceptParentForStudent,
  bootstrapVerifiedParentWithInvite,
  seedStudentUser,
} from "../../helpers/family-access";
import { createTestArtifactStore } from "../../helpers/data-lifecycle";
import {
  bootstrapParentStudentRelationship,
  DEFAULT_PLAN_BODY,
  resetScheduleTables,
} from "../../helpers/schedule";
import { completeReactionSession, ensureM5TrainingDefinitions } from "../../helpers/training";
import { closeTestDb, getTestDb, migrateTestDb, resetIdentityTables } from "../../helpers/db";

config({ path: ".env.local" });
config({ path: ".env" });

const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("M6 P2 freeze matrix", () => {
  const db = getTestDb();
  const artifactStore = createTestArtifactStore();

  beforeAll(async () => {
    process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";
    await migrateTestDb();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    await resetIdentityTables(db);
    await resetScheduleTables(db);
  });

  async function freezeStudent(studentId: string) {
    await createDeletionRequest(db, {
      targetType: DELETION_TARGET_TYPE.STUDENT_ACCOUNT,
      targetId: studentId,
      requestedBy: studentId,
      requesterRole: "student",
      idempotencyKey: `freeze-${studentId.slice(0, 8)}`,
      artifactStore,
    });
  }

  function expectFrozen(error: unknown): boolean {
    return error instanceof DataLifecycleError && error.code === "FROZEN";
  }

  it("P2-R01: freeze blocks M4 reflection read", async () => {
    const student = await seedStudentUser(db, {
      username: `matrix_ref_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });
    await freezeStudent(student.studentId);

    await expect(
      getDailyReflection(db, {
        actorId: student.studentId,
        actorRole: "student",
        studentId: student.studentId,
        familyDate: toFamilyDate(),
      }),
    ).rejects.toSatisfy(expectFrozen);
  });

  it("P2-R01: freeze blocks M3 ledger read", async () => {
    const student = await seedStudentUser(db, {
      username: `matrix_ledger_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });
    await freezeStudent(student.studentId);

    await expect(queryPointsBalance(db, student.studentId)).rejects.toSatisfy(expectFrozen);
  });

  it("P2-R01: freeze blocks M2 schedule read", async () => {
    const student = await seedStudentUser(db, {
      username: `matrix_sched_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });
    await freezeStudent(student.studentId);

    await expect(
      queryScheduleItems(db, {
        studentId: student.studentId,
        from: "2026-01-01",
        to: "2026-12-31",
      }),
    ).rejects.toSatisfy(expectFrozen);
  });

  it("P2-R01: freeze blocks M6 redemption read", async () => {
    const student = await seedStudentUser(db, {
      username: `matrix_red_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });
    await freezeStudent(student.studentId);

    await expect(listRedemptions(db, student.studentId)).rejects.toSatisfy(expectFrozen);
    await expect(
      listCatalogItems(db, student.studentId, { viewerRole: "student" }),
    ).rejects.toSatisfy(expectFrozen);
  });

  it("P2-R01: freeze blocks M5 training write", async () => {
    const student = await seedStudentUser(db, {
      username: `matrix_train_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
      birthDate: "2015-06-01",
    });
    await freezeStudent(student.studentId);

    await expect(
      startTrainingSession(db, {
        studentId: student.studentId,
        trainingKey: "reaction",
        idempotencyKey: "train-after-freeze",
      }),
    ).rejects.toSatisfy(expectFrozen);
  });

  it("P2-R01: cross-student access does not leak existence via freeze error shape", async () => {
    const email = `matrix_parent_${crypto.randomUUID().slice(0, 8)}@test.local`;
    const { parentId } = await bootstrapVerifiedParentWithInvite(db, email);
    const studentA = await seedStudentUser(db, {
      username: `matrix_a_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });
    const studentB = await seedStudentUser(db, {
      username: `matrix_b_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });
    await acceptParentForStudent(db, { parentId, studentId: studentA.studentId });
    await freezeStudent(studentB.studentId);

    try {
      await queryPointsBalance(db, studentB.studentId);
      expect.fail("expected frozen error");
    } catch (error) {
      expect(String(error)).not.toContain(studentB.username);
      expect(expectFrozen(error)).toBe(true);
    }
  });

  it("C04: freeze revokes existing session (validateSession null)", async () => {
    const student = await seedStudentUser(db, {
      username: `matrix_validate_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });

    const loginResult = await login(db, {
      identifier: student.username,
      password: student.password,
      idempotencyKey: "login-before-validate-freeze",
    });

    await freezeStudent(student.studentId);

    // createDeletionRequest deletes sessions + bumps epoch; pre-freeze cookie is dead.
    const session = await validateSession(db, loginResult.sessionId);
    expect(session).toBeNull();
  });

  it("C04: freeze blocks relationship end command", async () => {
    const email = `matrix_rel_${crypto.randomUUID().slice(0, 8)}@test.local`;
    const { parentId } = await bootstrapVerifiedParentWithInvite(db, email);
    const student = await seedStudentUser(db, {
      username: `matrix_rel_child_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });
    const accepted = await acceptParentForStudent(db, { parentId, studentId: student.studentId });
    await freezeStudent(student.studentId);

    await expect(
      endRelationship(db, {
        actorId: parentId,
        relationshipId: accepted.relationshipId,
        idempotencyKey: "end-after-freeze",
      }),
    ).rejects.toSatisfy(expectFrozen);
  });

  it("C04: freeze blocks M3 ledger ledger read", async () => {
    const student = await seedStudentUser(db, {
      username: `matrix_ledger_entries_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });
    await freezeStudent(student.studentId);

    await expect(queryPointsLedger(db, student.studentId, 10)).rejects.toSatisfy(expectFrozen);
  });

  it("C04: freeze blocks M5 training session read", async () => {
    const { studentId } = await bootstrapParentStudentRelationship(db);
    const training = await completeReactionSession(db, studentId, {
      startIdempotencyKey: "matrix-read-start",
      submitIdempotencyKey: "matrix-read-submit",
    });
    await freezeStudent(studentId);

    await expect(
      getTrainingSessionForStudent(db, studentId, training.submitted.sessionId),
    ).rejects.toSatisfy(expectFrozen);
  });

  it("C04: freeze blocks M5 training submit write", async () => {
    const student = await seedStudentUser(db, {
      username: `matrix_submit_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
      birthDate: "2015-06-01",
    });

    await ensureM5TrainingDefinitions(db);

    const started = await startTrainingSession(db, {
      studentId: student.studentId,
      trainingKey: "reaction",
      idempotencyKey: "matrix-submit-start",
    });

    await freezeStudent(student.studentId);

    await expect(
      submitTrainingSession(db, {
        studentId: student.studentId,
        sessionId: started.sessionId,
        idempotencyKey: "matrix-submit-after-freeze",
      }),
    ).rejects.toSatisfy(expectFrozen);
  });

  it("C04: freeze blocks M2 schedule complete write", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);
    await createFormalPlan(db, {
      ownerId: parentId,
      studentId,
      idempotencyKey: "matrix-complete-plan",
      body: DEFAULT_PLAN_BODY,
    });

    const items = await queryScheduleItems(db, {
      studentId,
      from: "2026-01-01",
      to: "2026-12-31",
    });
    const pending = items.find((item) => item.status === "pending");
    expect(pending).toBeDefined();

    await freezeStudent(studentId);

    await expect(
      completeScheduleItem(db, {
        actorId: studentId,
        scheduleItemId: pending!.id,
        idempotencyKey: "matrix-complete-after-freeze",
      }),
    ).rejects.toSatisfy(expectFrozen);
  });

  it("C04: freeze blocks parent training summary aggregate read", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);
    await completeReactionSession(db, studentId, {
      startIdempotencyKey: "matrix-summary-start",
      submitIdempotencyKey: "matrix-summary-submit",
    });
    await freezeStudent(studentId);

    await expect(
      getTrainingSummaryForParent(db, parentId, studentId, "reaction"),
    ).rejects.toSatisfy(expectFrozen);
  });

  it("F02: frozen student cannot re-login or validate a generic session", async () => {
    const student = await seedStudentUser(db, {
      username: `matrix_login_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });

    await freezeStudent(student.studentId);

    // Normal login is fail-closed for frozen students (no generic session).
    await expect(
      login(db, {
        identifier: student.username,
        password: student.password,
        idempotencyKey: "login-after-freeze",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    // Even a session crafted AFTER the freeze (with the current authorization
    // epoch) fails validation while frozen.
    const [user] = await db.select().from(users).where(eq(users.id, student.studentId)).limit(1);
    const lucia = createLucia(db);
    const crafted = await lucia.createSession(student.studentId, {
      authorizationEpoch: user!.authorizationEpoch,
    });
    const session = await validateSession(db, crafted.id);
    expect(session).toBeNull();
  });

  it("F02: narrow deletion capability allows cancel but grants no ordinary access", async () => {
    const student = await seedStudentUser(db, {
      username: `matrix_cap_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });

    const created = await createDeletionRequest(db, {
      targetType: DELETION_TARGET_TYPE.STUDENT_ACCOUNT,
      targetId: student.studentId,
      requestedBy: student.studentId,
      requesterRole: "student",
      idempotencyKey: "capability-freeze",
      artifactStore,
    });

    const { issueDeletionCapability } =
      await import("@/modules/data-lifecycle/deletion-capability.service");
    const issued = await issueDeletionCapability(db, {
      identifier: student.username,
      password: student.password,
      requestId: created.requestId,
    });
    expect(issued.capabilityToken).toBeTruthy();

    // The capability cancels the request (account becomes accessible again).
    const { cancelDeletionRequest } =
      await import("@/modules/data-lifecycle/deletion-request.service");
    const cancelled = await cancelDeletionRequest(db, {
      requestId: created.requestId,
      capabilityToken: issued.capabilityToken,
      idempotencyKey: "capability-cancel",
    });
    expect(cancelled.status).toBe("cancelled");

    // After cancel, the account is no longer frozen and ordinary writes work again.
    await expect(
      upsertDailyReflection(db, {
        studentId: student.studentId,
        familyDate: toFamilyDate(),
        visibility: "normal",
        body: "allowed after capability cancel",
        idempotencyKey: "allowed-after-capability-cancel",
      }),
    ).resolves.toBeDefined();
  });

  it("F04: freeze blocks training trends read", async () => {
    const student = await seedStudentUser(db, {
      username: `matrix_trends_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
      birthDate: "2015-06-01",
    });
    await freezeStudent(student.studentId);

    await expect(
      queryTrainingTrends(db, {
        studentId: student.studentId,
        trainingKey: "reaction",
        window: "all",
      }),
    ).rejects.toSatisfy(expectFrozen);
  });

  it("F04: freeze blocks parent schedule write", async () => {
    const email = `matrix_plan_${crypto.randomUUID().slice(0, 8)}@test.local`;
    const { parentId } = await bootstrapVerifiedParentWithInvite(db, email);
    const student = await seedStudentUser(db, {
      username: `matrix_plan_child_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });
    await acceptParentForStudent(db, { parentId, studentId: student.studentId });
    await freezeStudent(student.studentId);

    await expect(
      createFormalPlan(db, {
        ownerId: parentId,
        studentId: student.studentId,
        idempotencyKey: "plan-after-freeze",
        body: {
          title: "Frozen plan",
          localTime: "09:00",
          startDate: toFamilyDate(),
        },
      }),
    ).rejects.toSatisfy(expectFrozen);
  });

  it("F04: freeze blocks parent settlement write", async () => {
    const email = `matrix_points_${crypto.randomUUID().slice(0, 8)}@test.local`;
    const { parentId } = await bootstrapVerifiedParentWithInvite(db, email);
    const student = await seedStudentUser(db, {
      username: `matrix_points_child_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });
    await acceptParentForStudent(db, { parentId, studentId: student.studentId });
    await freezeStudent(student.studentId);

    await expect(
      enablePointRule(db, {
        parentId,
        studentId: student.studentId,
        idempotencyKey: "points-after-freeze",
        body: { templateId: SCHEDULE_SYSTEM_COMPLETE_V1 },
      }),
    ).rejects.toSatisfy(expectFrozen);
  });

  it("F04: cancel restores previously frozen write access", async () => {
    const student = await seedStudentUser(db, {
      username: `matrix_cancel_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });

    const created = await createDeletionRequest(db, {
      targetType: DELETION_TARGET_TYPE.STUDENT_ACCOUNT,
      targetId: student.studentId,
      requestedBy: student.studentId,
      requesterRole: "student",
      idempotencyKey: "cancel-restore-freeze",
      artifactStore,
    });

    await expect(
      upsertDailyReflection(db, {
        studentId: student.studentId,
        familyDate: toFamilyDate(),
        visibility: "normal",
        body: "blocked before cancel",
        idempotencyKey: "blocked-before-cancel",
      }),
    ).rejects.toSatisfy(expectFrozen);

    const { cancelDeletionRequest } =
      await import("@/modules/data-lifecycle/deletion-request.service");

    await cancelDeletionRequest(db, {
      requestId: created.requestId,
      actorId: student.studentId,
      idempotencyKey: "cancel-restore",
    });

    await expect(
      upsertDailyReflection(db, {
        studentId: student.studentId,
        familyDate: toFamilyDate(),
        visibility: "normal",
        body: "allowed after cancel",
        idempotencyKey: "allowed-after-cancel",
      }),
    ).resolves.toBeDefined();
  });
});
