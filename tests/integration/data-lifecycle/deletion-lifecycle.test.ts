import { config } from "dotenv";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { auditEvents, dailyReflections, deletionTombstones, users } from "@/db/schema";
import { login, validateSession } from "@/modules/identity/login.service";
import { DataLifecycleError } from "@/modules/data-lifecycle/errors";
import { DELETION_TARGET_TYPE } from "@/modules/data-lifecycle/constants";
import {
  applyTombstonesBeforeProjectionRebuild,
  cancelDeletionRequest,
  confirmDeletionRequest,
  createDeletionRequest,
  processDeletionWorker,
} from "@/modules/data-lifecycle/deletion-request.service";
import { getDailyReflection } from "@/modules/reflection-privacy/get-daily-reflection.service";
import { upsertDailyReflection } from "@/modules/reflection-privacy/upsert-daily-reflection.service";
import { rebuildProjectionForStudent } from "@/modules/projection/rebuild-projection.service";
import { toFamilyDate } from "@/modules/time-policy/to-family-date";
import { seedStudentUser } from "../../helpers/family-access";
import { createTestArtifactStore } from "../../helpers/data-lifecycle";
import { bootstrapAdmin } from "../../helpers/identity";
import { closeTestDb, getTestDb, migrateTestDb, resetIdentityTables } from "../../helpers/db";

config({ path: ".env.local" });
config({ path: ".env" });

const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("M6 P2 deletion lifecycle", () => {
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

  it("AC-M6-05: deletion request immediately freezes reads and writes", async () => {
    const student = await seedStudentUser(db, {
      username: `freeze_student_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });

    const loginResult = await login(db, {
      identifier: student.username,
      password: student.password,
      idempotencyKey: "login-before-freeze",
    });

    await createDeletionRequest(db, {
      targetType: DELETION_TARGET_TYPE.STUDENT_ACCOUNT,
      targetId: student.studentId,
      requestedBy: student.studentId,
      requesterRole: "student",
      idempotencyKey: "freeze-account",
      artifactStore,
    });

    await expect(
      getDailyReflection(db, {
        actorId: student.studentId,
        actorRole: "student",
        studentId: student.studentId,
        familyDate: toFamilyDate(),
      }),
    ).rejects.toBeInstanceOf(DataLifecycleError);

    await expect(
      upsertDailyReflection(db, {
        studentId: student.studentId,
        familyDate: toFamilyDate(),
        visibility: "normal",
        body: "should be blocked",
        idempotencyKey: "upsert-after-freeze",
      }),
    ).rejects.toBeInstanceOf(DataLifecycleError);

    const sessionAfterFreeze = await validateSession(db, loginResult.sessionId);
    expect(sessionAfterFreeze).toBeNull();
  });

  it("AC-M6-05: student can cancel within revocation window", async () => {
    const student = await seedStudentUser(db, {
      username: `cancel_student_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });

    const created = await createDeletionRequest(db, {
      targetType: DELETION_TARGET_TYPE.STUDENT_ACCOUNT,
      targetId: student.studentId,
      requestedBy: student.studentId,
      requesterRole: "student",
      idempotencyKey: "cancel-freeze",
      artifactStore,
    });

    const cancelled = await cancelDeletionRequest(db, {
      requestId: created.requestId,
      actorId: student.studentId,
      idempotencyKey: "cancel-deletion",
    });

    expect(cancelled.status).toBe("cancelled");

    await expect(
      upsertDailyReflection(db, {
        studentId: student.studentId,
        familyDate: toFamilyDate(),
        visibility: "normal",
        body: "restored access after cancel",
        idempotencyKey: "upsert-after-cancel",
      }),
    ).resolves.toBeDefined();
  });

  it("AC-M6-05: execution requires student confirmation", async () => {
    const student = await seedStudentUser(db, {
      username: `confirm_student_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });

    const created = await createDeletionRequest(db, {
      targetType: DELETION_TARGET_TYPE.STUDENT_ACCOUNT,
      targetId: student.studentId,
      requestedBy: student.studentId,
      requesterRole: "student",
      idempotencyKey: "needs-confirm",
      artifactStore,
    });

    await expect(
      processDeletionWorker(db, { requestId: created.requestId, artifactStore }),
    ).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });

    await confirmDeletionRequest(db, {
      requestId: created.requestId,
      studentId: student.studentId,
      idempotencyKey: "student-confirm",
    });

    const executed = await processDeletionWorker(db, {
      requestId: created.requestId,
      artifactStore,
    });

    expect(executed.status).toBe("executed");
  });

  it("AC-M6-06: executed deletion clears PII but retains ledger amounts", async () => {
    const student = await seedStudentUser(db, {
      username: `purge_student_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
      displayName: "Purge Me Student",
    });

    await upsertDailyReflection(db, {
      studentId: student.studentId,
      familyDate: toFamilyDate(),
      visibility: "normal",
      body: "reflection body to purge",
      idempotencyKey: "reflection-for-purge",
    });

    const created = await createDeletionRequest(db, {
      targetType: DELETION_TARGET_TYPE.STUDENT_ACCOUNT,
      targetId: student.studentId,
      requestedBy: student.studentId,
      requesterRole: "student",
      idempotencyKey: "purge-account",
      artifactStore,
    });

    await confirmDeletionRequest(db, {
      requestId: created.requestId,
      studentId: student.studentId,
      idempotencyKey: "confirm-purge",
    });

    await processDeletionWorker(db, { requestId: created.requestId, artifactStore });

    const [user] = await db.select().from(users).where(eq(users.id, student.studentId)).limit(1);
    expect(user!.displayName).toBe("Deleted User");
    expect(user!.email).toBeNull();
    expect(user!.username).toContain("deleted_");

    const reflections = await db
      .select()
      .from(dailyReflections)
      .where(eq(dailyReflections.studentId, student.studentId));

    for (const reflection of reflections) {
      expect(reflection.body).toBe("");
      expect(reflection.deletedAt).not.toBeNull();
    }

    const [tombstone] = await db
      .select()
      .from(deletionTombstones)
      .where(eq(deletionTombstones.deletionRequestId, created.requestId))
      .limit(1);

    expect(tombstone).toBeDefined();

    const audits = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "deletion.executed"));

    expect(audits.length).toBeGreaterThan(0);
    expect(JSON.stringify(audits)).not.toContain("reflection body to purge");
  });

  it("AC-M6-06: repeat execution and dead replay are idempotent", async () => {
    const student = await seedStudentUser(db, {
      username: `idempotent_del_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });

    const created = await createDeletionRequest(db, {
      targetType: DELETION_TARGET_TYPE.STUDENT_ACCOUNT,
      targetId: student.studentId,
      requestedBy: student.studentId,
      requesterRole: "student",
      idempotencyKey: "idempotent-deletion",
      artifactStore,
    });

    await confirmDeletionRequest(db, {
      requestId: created.requestId,
      studentId: student.studentId,
      idempotencyKey: "confirm-idempotent",
    });

    const first = await processDeletionWorker(db, { requestId: created.requestId, artifactStore });
    const second = await processDeletionWorker(db, { requestId: created.requestId, artifactStore });

    expect(first.executed).toBe(true);
    expect(second.executed).toBe(false);

    const tombstones = await db
      .select()
      .from(deletionTombstones)
      .where(eq(deletionTombstones.targetId, student.studentId));

    expect(tombstones).toHaveLength(1);
  });

  it("AC-M6-06: tombstone replay prevents body recovery after projection rebuild", async () => {
    const student = await seedStudentUser(db, {
      username: `tombstone_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
      displayName: "Tombstone Student",
    });

    const secretBody = "tombstone-secret-body";
    await upsertDailyReflection(db, {
      studentId: student.studentId,
      familyDate: toFamilyDate(),
      visibility: "normal",
      body: secretBody,
      idempotencyKey: "reflection-tombstone",
    });

    const created = await createDeletionRequest(db, {
      targetType: DELETION_TARGET_TYPE.STUDENT_ACCOUNT,
      targetId: student.studentId,
      requestedBy: student.studentId,
      requesterRole: "student",
      idempotencyKey: "tombstone-deletion",
      artifactStore,
    });

    await confirmDeletionRequest(db, {
      requestId: created.requestId,
      studentId: student.studentId,
      idempotencyKey: "confirm-tombstone",
    });

    await processDeletionWorker(db, { requestId: created.requestId, artifactStore });

    await db.transaction(async (tx) => {
      await tx
        .update(dailyReflections)
        .set({ body: secretBody, deletedAt: null, bodyPurgedAt: null })
        .where(eq(dailyReflections.studentId, student.studentId));

      await applyTombstonesBeforeProjectionRebuild(tx);
      await rebuildProjectionForStudent(tx, student.studentId);
    });

    const reflections = await db
      .select()
      .from(dailyReflections)
      .where(eq(dailyReflections.studentId, student.studentId));

    for (const reflection of reflections) {
      expect(reflection.body).toBe("");
    }
  });

  it("AC-M6-05: independent daily reflection deletion purges only target", async () => {
    const student = await seedStudentUser(db, {
      username: `reflection_del_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });

    const targetBody = "target reflection body";
    const keepBody = "keep this reflection";
    const today = toFamilyDate();

    const target = await upsertDailyReflection(db, {
      studentId: student.studentId,
      familyDate: today,
      visibility: "normal",
      body: targetBody,
      idempotencyKey: "target-reflection",
    });

    const now = new Date();
    await db.insert(dailyReflections).values({
      studentId: student.studentId,
      familyDate: "2025-01-01",
      visibility: "normal",
      body: keepBody,
      currentVersion: 1,
      upsertIdempotencyKey: "keep-reflection-seed",
      createdAt: now,
      updatedAt: now,
    });

    const created = await createDeletionRequest(db, {
      targetType: DELETION_TARGET_TYPE.DAILY_REFLECTION,
      targetId: target.reflection.reflectionId,
      requestedBy: student.studentId,
      requesterRole: "student",
      idempotencyKey: "delete-reflection",
      artifactStore,
    });

    await confirmDeletionRequest(db, {
      requestId: created.requestId,
      studentId: student.studentId,
      idempotencyKey: "confirm-reflection-del",
    });

    await processDeletionWorker(db, { requestId: created.requestId, artifactStore });

    const [purged] = await db
      .select()
      .from(dailyReflections)
      .where(eq(dailyReflections.id, target.reflection.reflectionId))
      .limit(1);

    const [kept] = await db
      .select()
      .from(dailyReflections)
      .where(
        and(
          eq(dailyReflections.studentId, student.studentId),
          eq(dailyReflections.familyDate, "2025-01-01"),
        ),
      )
      .limit(1);

    expect(purged!.body).toBe("");
    expect(kept!.body).toBe(keepBody);
  });

  it("AC-M6-05: admin force records audit without exposing body", async () => {
    const { adminId } = await bootstrapAdmin(
      db,
      `admin_del_${crypto.randomUUID().slice(0, 8)}@test.local`,
    );
    const student = await seedStudentUser(db, {
      username: `admin_force_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });

    const created = await createDeletionRequest(db, {
      targetType: DELETION_TARGET_TYPE.STUDENT_ACCOUNT,
      targetId: student.studentId,
      requestedBy: student.studentId,
      requesterRole: "student",
      idempotencyKey: "admin-force-target",
      artifactStore,
    });

    const { adminForceDeletionExecution } =
      await import("@/modules/data-lifecycle/deletion-request.service");

    await adminForceDeletionExecution(db, {
      requestId: created.requestId,
      adminId,
      reason: "legal retention request",
      idempotencyKey: "admin-force-1",
    });

    const audits = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "deletion.admin_force"));

    expect(audits).toHaveLength(1);
    expect(audits[0]!.reasonCode).toBe("admin_force_deletion");
  });
});
