import { config } from "dotenv";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { DataLifecycleError } from "@/modules/data-lifecycle/errors";
import { DELETION_TARGET_TYPE } from "@/modules/data-lifecycle/constants";
import { createDeletionRequest } from "@/modules/data-lifecycle/deletion-request.service";
import { listCatalogItems } from "@/modules/redemption/catalog.service";
import { listRedemptions } from "@/modules/redemption/redemption.service";
import { queryPointsBalance } from "@/modules/settlement/ledger.service";
import { queryScheduleItems } from "@/modules/schedule/schedule-query.service";
import { getDailyReflection } from "@/modules/reflection-privacy/get-daily-reflection.service";
import { startTrainingSession } from "@/modules/training/session.service";
import { toFamilyDate } from "@/modules/time-policy/to-family-date";
import {
  acceptParentForStudent,
  bootstrapVerifiedParentWithInvite,
  seedStudentUser,
} from "../../helpers/family-access";
import { createTestArtifactStore } from "../../helpers/data-lifecycle";
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
});
