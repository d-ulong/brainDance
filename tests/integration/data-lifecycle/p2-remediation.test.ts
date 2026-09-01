import { config } from "dotenv";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { auditEvents, exportJobs, outboxEvents, relationships } from "@/db/schema";
import { DataLifecycleError } from "@/modules/data-lifecycle/errors";
import { DELETION_TARGET_TYPE } from "@/modules/data-lifecycle/constants";
import {
  confirmDeletionRequest,
  createDeletionRequest,
  getDeletionRequestForActor,
  processDeletionWorker,
} from "@/modules/data-lifecycle/deletion-request.service";
import {
  createExportJob,
  getExportJobStatusForActor,
  processExportJob,
} from "@/modules/data-lifecycle/export-job.service";
import { applyTombstonesBeforeProjectionRebuild } from "@/modules/data-lifecycle/tombstone-replay.service";
import { countActivePrivateGrantsForStudent } from "@/modules/family-access/account-deletion.service";
import { countNonEmptyTrainingPayloadsForStudent } from "@/modules/training/account-deletion.service";
import {
  acceptParentForStudent,
  bootstrapVerifiedParentWithInvite,
  seedStudentUser,
} from "../../helpers/family-access";
import {
  createFaultInjectedArtifactStore,
  createTestArtifactStore,
} from "../../helpers/data-lifecycle";
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

describe.skipIf(!hasDb)("M6 P2 consolidated remediation", () => {
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

  it("F02: export job status rejects non-owner with NOT_FOUND shape", async () => {
    const student = await seedStudentUser(db, {
      username: `f02_owner_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });
    const other = await seedStudentUser(db, {
      username: `f02_other_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });

    const created = await createExportJob(db, {
      requesterId: student.studentId,
      requesterRole: "student",
      studentId: student.studentId,
      idempotencyKey: "f02-export",
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

  it("F02: deletion request detail rejects cross-student with NOT_FOUND shape", async () => {
    const student = await seedStudentUser(db, {
      username: `f02_del_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });
    const other = await seedStudentUser(db, {
      username: `f02_del_other_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });

    const created = await createDeletionRequest(db, {
      targetType: DELETION_TARGET_TYPE.STUDENT_ACCOUNT,
      targetId: student.studentId,
      requestedBy: student.studentId,
      requesterRole: "student",
      idempotencyKey: "f02-deletion",
      artifactStore,
    });

    await expect(
      getDeletionRequestForActor(db, created.requestId, {
        actorId: other.studentId,
        actorRole: "student",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("F03: student export artifact includes schedule and training_summary sections", async () => {
    const student = await seedStudentUser(db, {
      username: `f03_export_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });

    const created = await createExportJob(db, {
      requesterId: student.studentId,
      requesterRole: "student",
      studentId: student.studentId,
      idempotencyKey: "f03-export-sections",
    });

    const processed = await processExportJob(db, { jobId: created.jobId, artifactStore });
    expect(processed.downloadTokenPlaintext).toBeTruthy();
    expect(artifactStore.has(`export/${created.jobId}`)).toBe(true);

    const [job] = await db
      .select()
      .from(exportJobs)
      .where(eq(exportJobs.id, created.jobId))
      .limit(1);

    const content = await artifactStore.openOnce(job!.artifactKey!);
    const artifact = JSON.parse(content!.toString("utf8"));

    expect(artifact.sections.schedule).toBeDefined();
    expect(artifact.sections.training_summary).toBeDefined();
    expect(JSON.stringify(artifact)).not.toMatch(/answer|payload/i);
  });

  it("F07: export create replays same payload and conflicts on different payload", async () => {
    const email = `f07_parent_${crypto.randomUUID().slice(0, 8)}@test.local`;
    const { parentId } = await bootstrapVerifiedParentWithInvite(db, email);
    const studentA = await seedStudentUser(db, {
      username: `f07_a_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });
    const studentB = await seedStudentUser(db, {
      username: `f07_b_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });
    await acceptParentForStudent(db, { parentId, studentId: studentA.studentId });
    await acceptParentForStudent(db, { parentId, studentId: studentB.studentId });

    const first = await createExportJob(db, {
      requesterId: parentId,
      requesterRole: "parent",
      studentId: studentA.studentId,
      idempotencyKey: "f07-export-key",
    });

    const replay = await createExportJob(db, {
      requesterId: parentId,
      requesterRole: "parent",
      studentId: studentA.studentId,
      idempotencyKey: "f07-export-key",
    });

    expect(replay.idempotentReplay).toBe(true);
    expect(replay.jobId).toBe(first.jobId);

    await expect(
      createExportJob(db, {
        requesterId: parentId,
        requesterRole: "parent",
        studentId: studentB.studentId,
        idempotencyKey: "f07-export-key",
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

  it("F07: deletion create concurrent same payload converges to one request", async () => {
    const student = await seedStudentUser(db, {
      username: `f07_del_${crypto.randomUUID().slice(0, 8)}`,
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
          idempotencyKey: "f07-del-concurrent",
          artifactStore,
        }),
        createDeletionRequest(connB.db, {
          targetType: DELETION_TARGET_TYPE.STUDENT_ACCOUNT,
          targetId: student.studentId,
          requestedBy: student.studentId,
          requesterRole: "student",
          idempotencyKey: "f07-del-concurrent",
          artifactStore,
        }),
      ]);

      expect(a.requestId).toBe(b.requestId);
    } finally {
      await connA.close();
      await connB.close();
    }
  });

  it("F06: concurrent export worker claims produce one ready artifact", async () => {
    const student = await seedStudentUser(db, {
      username: `f06_worker_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });

    const created = await createExportJob(db, {
      requesterId: student.studentId,
      requesterRole: "student",
      studentId: student.studentId,
      idempotencyKey: "f06-worker-concurrent",
    });

    const connA = createIndependentTestDb();
    const connB = createIndependentTestDb();
    const storeA = createTestArtifactStore();
    const storeB = createTestArtifactStore();

    try {
      const [a, b] = await Promise.allSettled([
        processExportJob(connA.db, { jobId: created.jobId, artifactStore: storeA }),
        processExportJob(connB.db, { jobId: created.jobId, artifactStore: storeB }),
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
    } finally {
      await connA.close();
      await connB.close();
    }
  });

  it("F06: artifact put failure marks job failed without accessible artifact", async () => {
    const student = await seedStudentUser(db, {
      username: `f06_fail_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });

    const created = await createExportJob(db, {
      requesterId: student.studentId,
      requesterRole: "student",
      studentId: student.studentId,
      idempotencyKey: "f06-fail-put",
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
    expect(failingStore.has(`export/${created.jobId}`)).toBe(false);
  });

  it("F05: account deletion revokes relationships and purges training payloads; tombstone replay holds", async () => {
    const email = `f05_parent_${crypto.randomUUID().slice(0, 8)}@test.local`;
    const { parentId } = await bootstrapVerifiedParentWithInvite(db, email);
    const student = await seedStudentUser(db, {
      username: `f05_student_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
      displayName: "F05 Student",
    });
    await acceptParentForStudent(db, { parentId, studentId: student.studentId });

    const created = await createDeletionRequest(db, {
      targetType: DELETION_TARGET_TYPE.STUDENT_ACCOUNT,
      targetId: student.studentId,
      requestedBy: student.studentId,
      requesterRole: "student",
      idempotencyKey: "f05-account-delete",
      artifactStore,
    });

    await confirmDeletionRequest(db, {
      requestId: created.requestId,
      studentId: student.studentId,
      idempotencyKey: "f05-confirm",
    });

    await processDeletionWorker(db, { requestId: created.requestId, artifactStore });

    const activeRelationships = await db
      .select()
      .from(relationships)
      .where(
        and(eq(relationships.studentId, student.studentId), eq(relationships.status, "active")),
      );
    expect(activeRelationships).toHaveLength(0);

    expect(await countActivePrivateGrantsForStudent(db, student.studentId)).toBe(0);
    expect(await countNonEmptyTrainingPayloadsForStudent(db, student.studentId)).toBe(0);

    await applyTombstonesBeforeProjectionRebuild(db);

    expect(await countActivePrivateGrantsForStudent(db, student.studentId)).toBe(0);
    expect(await countNonEmptyTrainingPayloadsForStudent(db, student.studentId)).toBe(0);
  });
});
