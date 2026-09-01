import { config } from "dotenv";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  auditEvents,
  dailyReflections,
  exportJobs,
  outboxEvents,
  pointBalanceProjection,
  privateAccessGrants,
  relationships,
  scheduleItems,
  sessions,
  users,
} from "@/db/schema";
import { DataLifecycleError } from "@/modules/data-lifecycle/errors";
import { DELETION_TARGET_TYPE, EXPORT_JOB_STATUS } from "@/modules/data-lifecycle/constants";
import {
  cancelDeletionRequest,
  confirmDeletionRequest,
  createDeletionRequest,
  getDeletionRequestForActor,
  processDeletionWorker,
} from "@/modules/data-lifecycle/deletion-request.service";
import {
  createExportJob,
  deliverExportDownload,
  getExportJobStatusForActor,
  processExportJob,
} from "@/modules/data-lifecycle/export-job.service";
import {
  applyTombstonesBeforeProjectionRebuild,
  assertTombstoneInvariants,
} from "@/modules/data-lifecycle/tombstone-replay.service";
import { countActiveRelationshipsForStudent } from "@/modules/family-access/account-deletion.service";
import { countActivePrivateGrantsForStudent } from "@/modules/reflection-privacy/account-deletion.service";
import { createFormalPlan } from "@/modules/schedule/plan.service";
import { countNonEmptyTrainingPayloadsForStudent } from "@/modules/training/account-deletion.service";
import {
  acceptParentForStudent,
  bootstrapVerifiedParentWithInvite,
  seedStudentUser,
} from "../../helpers/family-access";
import {
  createFaultInjectedArtifactStore,
  createTestArtifactStore,
  seedPrivateReflection,
  seedSharedReflection,
} from "../../helpers/data-lifecycle";
import { bootstrapAdmin } from "../../helpers/identity";
import { bootstrapParentStudentRelationship, DEFAULT_PLAN_BODY } from "../../helpers/schedule";
import { seedStudentBalance } from "../../helpers/redemption";
import { completeReactionSession } from "../../helpers/training";
import {
  closeTestDb,
  createIndependentTestDb,
  getTestDb,
  migrateTestDb,
  resetIdentityTables,
} from "../../helpers/db";

config({ path: ".env.local" });
config({ path: ".env" });

const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("M6 P2 final acceptance correction (C01–C07)", () => {
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

  it("C01: account deletion revokes relationships and grants via separate module seams", async () => {
    const email = `c01_parent_${crypto.randomUUID().slice(0, 8)}@test.local`;
    const { parentId } = await bootstrapVerifiedParentWithInvite(db, email);
    const student = await seedStudentUser(db, {
      username: `c01_student_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });
    await acceptParentForStudent(db, { parentId, studentId: student.studentId });
    await seedPrivateReflection(db, {
      studentId: student.studentId,
      parentId,
      body: "private grant body",
    });

    const created = await createDeletionRequest(db, {
      targetType: DELETION_TARGET_TYPE.STUDENT_ACCOUNT,
      targetId: student.studentId,
      requestedBy: student.studentId,
      requesterRole: "student",
      idempotencyKey: "c01-delete",
      artifactStore,
    });

    await confirmDeletionRequest(db, {
      requestId: created.requestId,
      studentId: student.studentId,
      idempotencyKey: "c01-confirm",
    });

    await processDeletionWorker(db, { requestId: created.requestId, artifactStore });

    expect(await countActiveRelationshipsForStudent(db, student.studentId)).toBe(0);
    expect(await countActivePrivateGrantsForStudent(db, student.studentId)).toBe(0);
  });

  it("C02: export status owner allowed and non-owner receives NOT_FOUND", async () => {
    const student = await seedStudentUser(db, {
      username: `c02_owner_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });
    const other = await seedStudentUser(db, {
      username: `c02_other_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });

    const created = await createExportJob(db, {
      requesterId: student.studentId,
      requesterRole: "student",
      studentId: student.studentId,
      idempotencyKey: "c02-export-status",
    });

    await expect(
      getExportJobStatusForActor(db, created.jobId, {
        actorId: other.studentId,
        actorRole: "student",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const status = await getExportJobStatusForActor(db, created.jobId, {
      actorId: student.studentId,
      actorRole: "student",
    });
    expect(status.id).toBe(created.jobId);
  });

  it("C02: deliverExportDownload rejects non-owner without route pre-check", async () => {
    const student = await seedStudentUser(db, {
      username: `c02_dl_owner_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });
    const other = await seedStudentUser(db, {
      username: `c02_dl_other_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });

    const created = await createExportJob(db, {
      requesterId: student.studentId,
      requesterRole: "student",
      studentId: student.studentId,
      idempotencyKey: "c02-export-dl",
    });

    const processed = await processExportJob(db, { jobId: created.jobId, artifactStore });

    await expect(
      deliverExportDownload(db, {
        jobId: created.jobId,
        tokenPlaintext: processed.downloadTokenPlaintext!,
        artifactStore,
        actor: { actorId: other.studentId, actorRole: "student" },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("C02: parent export status rejects cross-student with NOT_FOUND", async () => {
    const email = `c02_parent_${crypto.randomUUID().slice(0, 8)}@test.local`;
    const { parentId } = await bootstrapVerifiedParentWithInvite(db, email);
    const studentA = await seedStudentUser(db, {
      username: `c02_a_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });
    const studentB = await seedStudentUser(db, {
      username: `c02_b_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });
    await acceptParentForStudent(db, { parentId, studentId: studentA.studentId });
    await acceptParentForStudent(db, { parentId, studentId: studentB.studentId });

    const created = await createExportJob(db, {
      requesterId: parentId,
      requesterRole: "parent",
      studentId: studentA.studentId,
      idempotencyKey: "c02-parent-export",
    });

    await expect(
      getExportJobStatusForActor(db, created.jobId, {
        actorId: parentId,
        actorRole: "parent",
      }),
    ).resolves.toBeDefined();

    const otherParentJob = await createExportJob(db, {
      requesterId: parentId,
      requesterRole: "parent",
      studentId: studentB.studentId,
      idempotencyKey: "c02-parent-export-b",
    });

    await expect(
      getExportJobStatusForActor(db, created.jobId, {
        actorId: studentB.studentId,
        actorRole: "student",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    void otherParentJob;
  });

  it("C02: deletion detail/cancel/confirm enforce student owner and admin boundaries", async () => {
    const { adminId } = await bootstrapAdmin(
      db,
      `c02_admin_${crypto.randomUUID().slice(0, 8)}@test.local`,
    );
    const student = await seedStudentUser(db, {
      username: `c02_del_owner_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });
    const other = await seedStudentUser(db, {
      username: `c02_del_other_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });

    const created = await createDeletionRequest(db, {
      targetType: DELETION_TARGET_TYPE.STUDENT_ACCOUNT,
      targetId: student.studentId,
      requestedBy: student.studentId,
      requesterRole: "student",
      idempotencyKey: "c02-deletion-auth",
      artifactStore,
    });

    await expect(
      getDeletionRequestForActor(db, created.requestId, {
        actorId: other.studentId,
        actorRole: "student",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const adminView = await getDeletionRequestForActor(db, created.requestId, {
      actorId: adminId,
      actorRole: "admin",
    });
    expect(adminView.id).toBe(created.requestId);

    await expect(
      cancelDeletionRequest(db, {
        requestId: created.requestId,
        actorId: other.studentId,
        idempotencyKey: "c02-cancel-other",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await expect(
      confirmDeletionRequest(db, {
        requestId: created.requestId,
        studentId: other.studentId,
        idempotencyKey: "c02-confirm-other",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("C03: student export artifact contains seeded section field values and exclusions", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);
    await seedStudentBalance(db, studentId, 42);

    await createFormalPlan(db, {
      ownerId: parentId,
      studentId,
      idempotencyKey: "c03-plan",
      body: DEFAULT_PLAN_BODY,
    });

    const normalBody = "normal reflection export body";
    await seedSharedReflection(db, { studentId, body: normalBody });

    const privateBody = "private reflection export body for student";
    const seededAt = new Date();
    await db.insert(dailyReflections).values({
      studentId,
      familyDate: "2025-06-02",
      visibility: "private",
      body: privateBody,
      currentVersion: 1,
      upsertIdempotencyKey: "c03-private-reflection",
      createdAt: seededAt,
      updatedAt: seededAt,
    });

    const training = await completeReactionSession(db, studentId, {
      startIdempotencyKey: "c03-train-start",
      submitIdempotencyKey: "c03-train-submit",
    });

    const created = await createExportJob(db, {
      requesterId: studentId,
      requesterRole: "student",
      studentId,
      idempotencyKey: "c03-export-content",
    });

    const processed = await processExportJob(db, { jobId: created.jobId, artifactStore });
    const delivered = await deliverExportDownload(db, {
      jobId: created.jobId,
      tokenPlaintext: processed.downloadTokenPlaintext!,
      artifactStore,
      actor: { actorId: studentId, actorRole: "student" },
    });

    const artifact = JSON.parse(delivered.content.toString("utf8")) as {
      sections: Record<string, unknown>;
    };

    const schedule = artifact.sections.schedule as Array<{ status: string; planId: string }>;
    expect(schedule.length).toBeGreaterThan(0);
    expect(schedule.some((item) => item.status === "pending" && item.planId)).toBe(true);

    const trainingSummary = artifact.sections.training_summary as Array<{
      id: string;
      trainingKey: string;
      metrics: Array<{ metricKey: string; value: number }>;
    }>;
    expect(trainingSummary.some((s) => s.id === training.submitted.sessionId)).toBe(true);
    expect(trainingSummary[0]!.metrics.length).toBeGreaterThan(0);
    expect(JSON.stringify(trainingSummary)).not.toMatch(/payload|answer/i);

    const reflections = artifact.sections.reflections as Array<{
      body: string;
      visibility: string;
    }>;
    expect(reflections.some((r) => r.body === normalBody && r.visibility === "normal")).toBe(true);
    expect(reflections.some((r) => r.body === privateBody)).toBe(true);

    const ledger = artifact.sections.ledger as { balance: number };
    expect(ledger.balance).toBe(42);
  });

  it("C03: parent export includes granted private reflection and excludes without grant", async () => {
    const email = `c03_parent_${crypto.randomUUID().slice(0, 8)}@test.local`;
    const { parentId } = await bootstrapVerifiedParentWithInvite(db, email);
    const student = await seedStudentUser(db, {
      username: `c03_child_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });
    await acceptParentForStudent(db, { parentId, studentId: student.studentId });

    const grantedBody = "granted-private-body-content";
    await seedPrivateReflection(db, { studentId: student.studentId, parentId, body: grantedBody });

    const noGrantBody = "no-grant-private-body";
    const now = new Date();
    await db.insert(dailyReflections).values({
      studentId: student.studentId,
      familyDate: "2025-06-01",
      visibility: "private",
      body: noGrantBody,
      currentVersion: 1,
      upsertIdempotencyKey: "c03-no-grant-reflection",
      createdAt: now,
      updatedAt: now,
    });

    const created = await createExportJob(db, {
      requesterId: parentId,
      requesterRole: "parent",
      studentId: student.studentId,
      idempotencyKey: "c03-parent-export",
    });

    const processed = await processExportJob(db, { jobId: created.jobId, artifactStore });
    const delivered = await deliverExportDownload(db, {
      jobId: created.jobId,
      tokenPlaintext: processed.downloadTokenPlaintext!,
      artifactStore,
      actor: { actorId: parentId, actorRole: "parent" },
    });

    const artifact = JSON.parse(delivered.content.toString("utf8"));
    const reflections = artifact.sections.reflections as Array<{ body: string }>;
    expect(reflections.some((r) => r.body === grantedBody)).toBe(true);
    expect(reflections.some((r) => r.body === noGrantBody)).toBe(false);
  });

  it("C05: tombstone replay re-applies deletion after full canary restoration", async () => {
    const email = `c05_parent_${crypto.randomUUID().slice(0, 8)}@test.local`;
    const { parentId } = await bootstrapVerifiedParentWithInvite(db, email);
    const student = await seedStudentUser(db, {
      username: `c05_student_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
      displayName: "Canary Student",
    });
    const accepted = await acceptParentForStudent(db, { parentId, studentId: student.studentId });
    const { reflectionId } = await seedPrivateReflection(db, {
      studentId: student.studentId,
      parentId,
      body: "canary reflection body",
    });

    await createFormalPlan(db, {
      ownerId: parentId,
      studentId: student.studentId,
      idempotencyKey: "c05-plan",
      body: DEFAULT_PLAN_BODY,
    });

    await completeReactionSession(db, student.studentId, {
      startIdempotencyKey: "c05-train-start",
      submitIdempotencyKey: "c05-train-submit",
    });

    const exportCreated = await createExportJob(db, {
      requesterId: student.studentId,
      requesterRole: "student",
      studentId: student.studentId,
      idempotencyKey: "c05-export",
    });
    await processExportJob(db, { jobId: exportCreated.jobId, artifactStore });

    const created = await createDeletionRequest(db, {
      targetType: DELETION_TARGET_TYPE.STUDENT_ACCOUNT,
      targetId: student.studentId,
      requestedBy: student.studentId,
      requesterRole: "student",
      idempotencyKey: "c05-delete",
      artifactStore,
    });

    await confirmDeletionRequest(db, {
      requestId: created.requestId,
      studentId: student.studentId,
      idempotencyKey: "c05-confirm",
    });

    await processDeletionWorker(db, { requestId: created.requestId, artifactStore });

    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({
          displayName: "Restored Canary",
          email: "canary@test.local",
          username: "canary_user",
          status: "active",
        })
        .where(eq(users.id, student.studentId));

      await tx.insert(sessions).values({
        id: crypto.randomUUID(),
        userId: student.studentId,
        expiresAt: new Date(Date.now() + 60_000),
        authorizationEpoch: 0,
      });

      await tx
        .update(relationships)
        .set({ status: "active", endedAt: null, endedBy: null })
        .where(eq(relationships.id, accepted.relationshipId));

      await tx
        .update(privateAccessGrants)
        .set({ revokedAt: null })
        .where(eq(privateAccessGrants.resourceId, reflectionId));

      await tx
        .update(dailyReflections)
        .set({ body: "restored reflection body", deletedAt: null, bodyPurgedAt: null })
        .where(eq(dailyReflections.studentId, student.studentId));

      await tx.execute(sql`
        UPDATE training_events
        SET payload = '{"trialIndex":0,"correct":true}'::jsonb
        FROM training_sessions
        WHERE training_events.session_id = training_sessions.id
          AND training_sessions.student_id = ${student.studentId}::uuid
      `);

      await tx
        .update(scheduleItems)
        .set({ status: "pending" })
        .where(eq(scheduleItems.studentId, student.studentId));

      await tx
        .update(exportJobs)
        .set({
          status: EXPORT_JOB_STATUS.READY,
          downloadTokenHash: "restored_hash",
          artifactKey: `export/${exportCreated.jobId}`,
        })
        .where(eq(exportJobs.id, exportCreated.jobId));

      await tx
        .update(pointBalanceProjection)
        .set({ balance: 999 })
        .where(eq(pointBalanceProjection.studentId, student.studentId));
    });

    await applyTombstonesBeforeProjectionRebuild(db, { artifactStore });
    await assertTombstoneInvariants(db, student.studentId);

    const [user] = await db.select().from(users).where(eq(users.id, student.studentId)).limit(1);
    expect(user!.displayName).toBe("Deleted User");
    expect(user!.status).toBe("disabled");

    const reflections = await db
      .select()
      .from(dailyReflections)
      .where(eq(dailyReflections.studentId, student.studentId));
    for (const reflection of reflections) {
      expect(reflection.body).toBe("");
    }

    expect(await countActiveRelationshipsForStudent(db, student.studentId)).toBe(0);
    expect(await countActivePrivateGrantsForStudent(db, student.studentId)).toBe(0);
    expect(await countNonEmptyTrainingPayloadsForStudent(db, student.studentId)).toBe(0);

    const pending = await db
      .select()
      .from(scheduleItems)
      .where(
        and(eq(scheduleItems.studentId, student.studentId), eq(scheduleItems.status, "pending")),
      );
    expect(pending).toHaveLength(0);

    const [job] = await db
      .select()
      .from(exportJobs)
      .where(eq(exportJobs.id, exportCreated.jobId))
      .limit(1);
    expect(job!.status).toBe("revoked");

    const sessionRows = await db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, student.studentId));
    expect(sessionRows).toHaveLength(0);

    const audits = await db.select().from(auditEvents);
    expect(JSON.stringify(audits)).not.toContain("restored reflection body");
  });

  it("C06: export job stays processing until artifact put completes", async () => {
    const student = await seedStudentUser(db, {
      username: `c06_ready_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });

    const created = await createExportJob(db, {
      requesterId: student.studentId,
      requesterRole: "student",
      studentId: student.studentId,
      idempotencyKey: "c06-ready-after-put",
    });

    const delayedStore = createFaultInjectedArtifactStore({ putDelayMs: 200 });

    const processingPromise = processExportJob(db, {
      jobId: created.jobId,
      artifactStore: delayedStore,
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const [mid] = await db
      .select()
      .from(exportJobs)
      .where(eq(exportJobs.id, created.jobId))
      .limit(1);
    expect(mid!.status).toBe("processing");
    expect(mid!.downloadTokenHash).toBeNull();

    const result = await processingPromise;
    expect(result.downloadTokenPlaintext).toBeTruthy();

    const [final] = await db
      .select()
      .from(exportJobs)
      .where(eq(exportJobs.id, created.jobId))
      .limit(1);
    expect(final!.status).toBe("ready");
    expect(final!.downloadTokenHash).toBeTruthy();
  });

  it("C06: concurrent export worker claims produce one ready artifact and token", async () => {
    const student = await seedStudentUser(db, {
      username: `c06_worker_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });

    const created = await createExportJob(db, {
      requesterId: student.studentId,
      requesterRole: "student",
      studentId: student.studentId,
      idempotencyKey: "c06-worker-concurrent",
    });

    const connA = createIndependentTestDb();
    const connB = createIndependentTestDb();
    const store = createTestArtifactStore();

    try {
      const [a, b] = await Promise.allSettled([
        processExportJob(connA.db, { jobId: created.jobId, artifactStore: store }),
        processExportJob(connB.db, { jobId: created.jobId, artifactStore: store }),
      ]);

      const fulfilled = [a, b].filter((result) => result.status === "fulfilled") as Array<
        PromiseFulfilledResult<Awaited<ReturnType<typeof processExportJob>>>
      >;

      expect(fulfilled.length).toBe(2);
      const replays = fulfilled.filter((result) => result.value.idempotentReplay);
      expect(replays.length).toBe(1);

      const [job] = await db
        .select()
        .from(exportJobs)
        .where(eq(exportJobs.id, created.jobId))
        .limit(1);

      expect(job!.status).toBe("ready");
      expect(job!.downloadTokenHash).toBeTruthy();
      expect(store.has(`export/${created.jobId}`)).toBe(true);
    } finally {
      await connA.close();
      await connB.close();
    }
  });

  it("C06: artifact put failure marks job failed without accessible download", async () => {
    const student = await seedStudentUser(db, {
      username: `c06_fail_put_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });

    const created = await createExportJob(db, {
      requesterId: student.studentId,
      requesterRole: "student",
      studentId: student.studentId,
      idempotencyKey: "c06-fail-put",
    });

    const failingStore = createFaultInjectedArtifactStore({ failPut: true });

    await expect(
      processExportJob(db, { jobId: created.jobId, artifactStore: failingStore }),
    ).rejects.toBeInstanceOf(DataLifecycleError);

    const [job] = await db
      .select()
      .from(exportJobs)
      .where(eq(exportJobs.id, created.jobId))
      .limit(1);

    expect(job!.status).toBe("failed");
    expect(job!.downloadTokenHash).toBeNull();
    expect(failingStore.has(`export/${created.jobId}`)).toBe(false);
  });

  it("C06: processing retry after interrupted worker completes ready state", async () => {
    const student = await seedStudentUser(db, {
      username: `c06_retry_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });

    const created = await createExportJob(db, {
      requesterId: student.studentId,
      requesterRole: "student",
      studentId: student.studentId,
      idempotencyKey: "c06-retry",
    });

    await db
      .update(exportJobs)
      .set({ status: EXPORT_JOB_STATUS.PROCESSING })
      .where(eq(exportJobs.id, created.jobId));

    const first = await processExportJob(db, { jobId: created.jobId, artifactStore });
    expect(first.idempotentReplay).toBe(false);

    const second = await processExportJob(db, { jobId: created.jobId, artifactStore });
    expect(second.idempotentReplay).toBe(true);
  });

  it("C06: concurrent download consumes token once", async () => {
    const student = await seedStudentUser(db, {
      username: `c06_conc_dl_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });

    const created = await createExportJob(db, {
      requesterId: student.studentId,
      requesterRole: "student",
      studentId: student.studentId,
      idempotencyKey: "c06-concurrent-dl",
    });

    const processed = await processExportJob(db, { jobId: created.jobId, artifactStore });
    const token = processed.downloadTokenPlaintext!;

    const results = await Promise.allSettled([
      deliverExportDownload(db, {
        jobId: created.jobId,
        tokenPlaintext: token,
        artifactStore,
        actor: { actorId: student.studentId, actorRole: "student" },
      }),
      deliverExportDownload(db, {
        jobId: created.jobId,
        tokenPlaintext: token,
        artifactStore,
        actor: { actorId: student.studentId, actorRole: "student" },
      }),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });

  it("C06: deletion worker concurrent execution converges to single executed state", async () => {
    const student = await seedStudentUser(db, {
      username: `c06_del_worker_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });

    const created = await createDeletionRequest(db, {
      targetType: DELETION_TARGET_TYPE.STUDENT_ACCOUNT,
      targetId: student.studentId,
      requestedBy: student.studentId,
      requesterRole: "student",
      idempotencyKey: "c06-del-concurrent-worker",
      artifactStore,
    });

    await confirmDeletionRequest(db, {
      requestId: created.requestId,
      studentId: student.studentId,
      idempotencyKey: "c06-del-confirm",
    });

    const connA = createIndependentTestDb();
    const connB = createIndependentTestDb();

    try {
      const [a, b] = await Promise.all([
        processDeletionWorker(connA.db, { requestId: created.requestId, artifactStore }),
        processDeletionWorker(connB.db, { requestId: created.requestId, artifactStore }),
      ]);

      expect(a.status).toBe("executed");
      expect(b.status).toBe("executed");
      expect([a.executed, b.executed].filter(Boolean)).toHaveLength(1);
    } finally {
      await connA.close();
      await connB.close();
    }
  });

  it("C07: export create replays same payload sequentially and conflicts on different payload", async () => {
    const email = `c07_export_${crypto.randomUUID().slice(0, 8)}@test.local`;
    const { parentId } = await bootstrapVerifiedParentWithInvite(db, email);
    const studentA = await seedStudentUser(db, {
      username: `c07_a_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });
    const studentB = await seedStudentUser(db, {
      username: `c07_b_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });
    await acceptParentForStudent(db, { parentId, studentId: studentA.studentId });
    await acceptParentForStudent(db, { parentId, studentId: studentB.studentId });

    const first = await createExportJob(db, {
      requesterId: parentId,
      requesterRole: "parent",
      studentId: studentA.studentId,
      idempotencyKey: "c07-export-key",
    });

    const replay = await createExportJob(db, {
      requesterId: parentId,
      requesterRole: "parent",
      studentId: studentA.studentId,
      idempotencyKey: "c07-export-key",
    });

    expect(replay.idempotentReplay).toBe(true);
    expect(replay.jobId).toBe(first.jobId);

    await expect(
      createExportJob(db, {
        requesterId: parentId,
        requesterRole: "parent",
        studentId: studentB.studentId,
        idempotencyKey: "c07-export-key",
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    const audits = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "export.create"));
    expect(audits).toHaveLength(1);

    const outbox = await db.select().from(outboxEvents);
    expect(outbox.filter((event) => event.eventType === "export.requested")).toHaveLength(1);
  });

  it("C07: export create concurrent same payload converges to one job", async () => {
    const student = await seedStudentUser(db, {
      username: `c07_exp_conc_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });

    const connA = createIndependentTestDb();
    const connB = createIndependentTestDb();

    try {
      const [a, b] = await Promise.all([
        createExportJob(connA.db, {
          requesterId: student.studentId,
          requesterRole: "student",
          studentId: student.studentId,
          idempotencyKey: "c07-export-concurrent",
        }),
        createExportJob(connB.db, {
          requesterId: student.studentId,
          requesterRole: "student",
          studentId: student.studentId,
          idempotencyKey: "c07-export-concurrent",
        }),
      ]);

      expect(a.jobId).toBe(b.jobId);
    } finally {
      await connA.close();
      await connB.close();
    }
  });

  it("C07: export create concurrent different payload yields one success and one conflict", async () => {
    const email = `c07_exp_diff_${crypto.randomUUID().slice(0, 8)}@test.local`;
    const { parentId } = await bootstrapVerifiedParentWithInvite(db, email);
    const studentA = await seedStudentUser(db, {
      username: `c07_exp_a_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });
    const studentB = await seedStudentUser(db, {
      username: `c07_exp_b_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });
    await acceptParentForStudent(db, { parentId, studentId: studentA.studentId });
    await acceptParentForStudent(db, { parentId, studentId: studentB.studentId });

    const connA = createIndependentTestDb();
    const connB = createIndependentTestDb();

    try {
      const [a, b] = await Promise.allSettled([
        createExportJob(connA.db, {
          requesterId: parentId,
          requesterRole: "parent",
          studentId: studentA.studentId,
          idempotencyKey: "c07-export-diff",
        }),
        createExportJob(connB.db, {
          requesterId: parentId,
          requesterRole: "parent",
          studentId: studentB.studentId,
          idempotencyKey: "c07-export-diff",
        }),
      ]);

      const fulfilled = [a, b].filter((r) => r.status === "fulfilled");
      const rejected = [a, b].filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      if (rejected[0]?.status === "rejected") {
        expect(rejected[0].reason).toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
      }
    } finally {
      await connA.close();
      await connB.close();
    }
  });

  it("C07: deletion create replays same payload sequentially and conflicts on different payload", async () => {
    const student = await seedStudentUser(db, {
      username: `c07_del_seq_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });

    const now = new Date();
    const [targetReflection] = await db
      .insert(dailyReflections)
      .values({
        studentId: student.studentId,
        familyDate: "2026-02-01",
        visibility: "normal",
        body: "target reflection",
        currentVersion: 1,
        upsertIdempotencyKey: "c07-target-reflection",
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: dailyReflections.id });

    const first = await createDeletionRequest(db, {
      targetType: DELETION_TARGET_TYPE.DAILY_REFLECTION,
      targetId: targetReflection!.id,
      requestedBy: student.studentId,
      requesterRole: "student",
      idempotencyKey: "c07-del-key",
      artifactStore,
    });

    const replay = await createDeletionRequest(db, {
      targetType: DELETION_TARGET_TYPE.DAILY_REFLECTION,
      targetId: targetReflection!.id,
      requestedBy: student.studentId,
      requesterRole: "student",
      idempotencyKey: "c07-del-key",
      artifactStore,
    });

    expect(replay.idempotentReplay).toBe(true);
    expect(replay.requestId).toBe(first.requestId);

    const [otherReflection] = await db
      .insert(dailyReflections)
      .values({
        studentId: student.studentId,
        familyDate: "2026-02-02",
        visibility: "normal",
        body: "other reflection",
        currentVersion: 1,
        upsertIdempotencyKey: "c07-other-reflection",
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: dailyReflections.id });

    await expect(
      createDeletionRequest(db, {
        targetType: DELETION_TARGET_TYPE.DAILY_REFLECTION,
        targetId: otherReflection!.id,
        requestedBy: student.studentId,
        requesterRole: "student",
        idempotencyKey: "c07-del-key",
        artifactStore,
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    const audits = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "deletion.request"));
    expect(audits).toHaveLength(1);
  });

  it("C07: deletion create concurrent same payload converges to one request", async () => {
    const student = await seedStudentUser(db, {
      username: `c07_del_conc_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });

    const connA = createIndependentTestDb();
    const connB = createIndependentTestDb();

    try {
      const [a, b] = await Promise.all([
        createDeletionRequest(connA.db, {
          targetType: DELETION_TARGET_TYPE.STUDENT_ACCOUNT,
          targetId: student.studentId,
          requestedBy: student.studentId,
          requesterRole: "student",
          idempotencyKey: "c07-del-concurrent",
          artifactStore,
        }),
        createDeletionRequest(connB.db, {
          targetType: DELETION_TARGET_TYPE.STUDENT_ACCOUNT,
          targetId: student.studentId,
          requestedBy: student.studentId,
          requesterRole: "student",
          idempotencyKey: "c07-del-concurrent",
          artifactStore,
        }),
      ]);

      expect(a.requestId).toBe(b.requestId);
    } finally {
      await connA.close();
      await connB.close();
    }
  });

  it("C07: deletion create concurrent different payload yields one success and one conflict", async () => {
    const student = await seedStudentUser(db, {
      username: `c07_del_diff_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });

    const now = new Date();
    const inserted = await db
      .insert(dailyReflections)
      .values([
        {
          studentId: student.studentId,
          familyDate: "2026-03-01",
          visibility: "normal",
          body: "reflection a",
          currentVersion: 1,
          upsertIdempotencyKey: "c07-reflection-a",
          createdAt: now,
          updatedAt: now,
        },
        {
          studentId: student.studentId,
          familyDate: "2026-03-02",
          visibility: "normal",
          body: "reflection b",
          currentVersion: 1,
          upsertIdempotencyKey: "c07-reflection-b",
          createdAt: now,
          updatedAt: now,
        },
      ])
      .returning({ id: dailyReflections.id });

    const connA = createIndependentTestDb();
    const connB = createIndependentTestDb();

    try {
      const [a, b] = await Promise.allSettled([
        createDeletionRequest(connA.db, {
          targetType: DELETION_TARGET_TYPE.DAILY_REFLECTION,
          targetId: inserted[0]!.id,
          requestedBy: student.studentId,
          requesterRole: "student",
          idempotencyKey: "c07-del-diff",
          artifactStore,
        }),
        createDeletionRequest(connB.db, {
          targetType: DELETION_TARGET_TYPE.DAILY_REFLECTION,
          targetId: inserted[1]!.id,
          requestedBy: student.studentId,
          requesterRole: "student",
          idempotencyKey: "c07-del-diff",
          artifactStore,
        }),
      ]);

      const fulfilled = [a, b].filter((r) => r.status === "fulfilled");
      const rejected = [a, b].filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      if (rejected[0]?.status === "rejected") {
        expect(rejected[0].reason).toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
      }
    } finally {
      await connA.close();
      await connB.close();
    }
  });
});
