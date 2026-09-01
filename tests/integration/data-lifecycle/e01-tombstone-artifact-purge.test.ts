import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { hashDownloadToken } from "@/lib/crypto";
import { auditEvents, deletionTombstones, exportJobs, outboxEvents } from "@/db/schema";
import { DELETION_TARGET_TYPE, EXPORT_JOB_STATUS } from "@/modules/data-lifecycle/constants";
import { DataLifecycleError } from "@/modules/data-lifecycle/errors";
import {
  confirmDeletionRequest,
  createDeletionRequest,
  processDeletionWorker,
} from "@/modules/data-lifecycle/deletion-request.service";
import {
  createExportJob,
  deliverExportDownload,
  processExportJob,
} from "@/modules/data-lifecycle/export-job.service";
import {
  applyTombstonesBeforeProjectionRebuild,
  readTombstoneArtifactPurgePendingKeys,
  TOMBSTONE_PAYLOAD_PENDING_KEYS,
} from "@/modules/data-lifecycle/tombstone-replay.service";
import { seedStudentUser } from "../../helpers/family-access";
import { createTestArtifactStore } from "../../helpers/data-lifecycle";
import { closeTestDb, getTestDb, migrateTestDb, resetIdentityTables } from "../../helpers/db";

config({ path: ".env.local" });
config({ path: ".env" });

const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("M6 P2 E01 tombstone artifact purge", () => {
  const db = getTestDb();

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

  async function executeStudentAccountDeletion(
    studentId: string,
    artifactStore: ReturnType<typeof createTestArtifactStore>,
  ) {
    const created = await createDeletionRequest(db, {
      targetType: DELETION_TARGET_TYPE.STUDENT_ACCOUNT,
      targetId: studentId,
      requestedBy: studentId,
      requesterRole: "student",
      idempotencyKey: `e01-delete-${crypto.randomUUID().slice(0, 8)}`,
      artifactStore,
    });

    await confirmDeletionRequest(db, {
      requestId: created.requestId,
      studentId,
      idempotencyKey: `e01-confirm-${crypto.randomUUID().slice(0, 8)}`,
    });

    await processDeletionWorker(db, { requestId: created.requestId, artifactStore });

    return created.requestId;
  }

  it("E01: tombstone replay purges restored ready export artifact and keeps job fail-closed", async () => {
    const artifactStore = createTestArtifactStore();
    const student = await seedStudentUser(db, {
      username: `e01_purge_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });

    const created = await createExportJob(db, {
      requesterId: student.studentId,
      requesterRole: "student",
      studentId: student.studentId,
      idempotencyKey: "e01-export",
    });

    const processed = await processExportJob(db, { jobId: created.jobId, artifactStore });
    void processed;
    const artifactKey = `export/${created.jobId}`;
    const canaryBody = Buffer.from('{"canary":"restored-export-body"}', "utf8");

    const restoredToken = "restored-canary-token-plaintext";

    await executeStudentAccountDeletion(student.studentId, artifactStore);

    await db
      .update(exportJobs)
      .set({
        status: EXPORT_JOB_STATUS.READY,
        downloadTokenHash: hashDownloadToken(restoredToken),
        artifactKey,
      })
      .where(eq(exportJobs.id, created.jobId));

    const restoredStore = createTestArtifactStore();
    await restoredStore.put(artifactKey, canaryBody);
    expect(restoredStore.has(artifactKey)).toBe(true);

    await applyTombstonesBeforeProjectionRebuild(db, { artifactStore: restoredStore });

    const [job] = await db
      .select()
      .from(exportJobs)
      .where(eq(exportJobs.id, created.jobId))
      .limit(1);

    expect(job!.status).toBe("revoked");
    expect(restoredStore.has(artifactKey)).toBe(false);

    await expect(
      deliverExportDownload(db, {
        jobId: created.jobId,
        tokenPlaintext: restoredToken,
        artifactStore: restoredStore,
        actor: { actorId: student.studentId, actorRole: "student" },
      }),
    ).rejects.toMatchObject({ code: "ARTIFACT_UNAVAILABLE" });
  });

  it("E01: purge failure persists pending keys fail-closed and retries after fault clears", async () => {
    const artifactStore = createTestArtifactStore();
    const restoredStore = createTestArtifactStore();
    let failPurge = true;
    const faultStore = {
      ...restoredStore,
      async purge(key: string) {
        if (failPurge) {
          throw new DataLifecycleError("ARTIFACT_UNAVAILABLE", "Injected artifact purge failure");
        }
        return restoredStore.purge(key);
      },
    };

    const student = await seedStudentUser(db, {
      username: `e01_retry_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });

    const created = await createExportJob(db, {
      requesterId: student.studentId,
      requesterRole: "student",
      studentId: student.studentId,
      idempotencyKey: "e01-export-retry",
    });

    await processExportJob(db, { jobId: created.jobId, artifactStore });
    const artifactKey = `export/${created.jobId}`;

    const deletionRequestId = await executeStudentAccountDeletion(student.studentId, artifactStore);

    await db
      .update(exportJobs)
      .set({
        status: EXPORT_JOB_STATUS.READY,
        downloadTokenHash: "restored_token_hash_retry",
        artifactKey,
      })
      .where(eq(exportJobs.id, created.jobId));

    await restoredStore.put(artifactKey, Buffer.from('{"canary":"retry-me"}', "utf8"));

    await expect(
      applyTombstonesBeforeProjectionRebuild(db, { artifactStore: faultStore }),
    ).rejects.toBeInstanceOf(DataLifecycleError);

    const [tombstoneAfterFailure] = await db
      .select()
      .from(deletionTombstones)
      .where(eq(deletionTombstones.deletionRequestId, deletionRequestId))
      .limit(1);

    expect(readTombstoneArtifactPurgePendingKeys(tombstoneAfterFailure!.payload)).toContain(
      artifactKey,
    );
    expect(tombstoneAfterFailure!.payload?.[TOMBSTONE_PAYLOAD_PENDING_KEYS]).toBeDefined();
    expect(restoredStore.has(artifactKey)).toBe(true);

    const [jobAfterFailure] = await db
      .select()
      .from(exportJobs)
      .where(eq(exportJobs.id, created.jobId))
      .limit(1);
    expect(jobAfterFailure!.status).toBe("revoked");

    failPurge = false;
    await applyTombstonesBeforeProjectionRebuild(db, { artifactStore: faultStore });

    expect(restoredStore.has(artifactKey)).toBe(false);

    const [tombstoneAfterRetry] = await db
      .select()
      .from(deletionTombstones)
      .where(eq(deletionTombstones.deletionRequestId, deletionRequestId))
      .limit(1);

    expect(readTombstoneArtifactPurgePendingKeys(tombstoneAfterRetry!.payload)).toHaveLength(0);
  });

  it("E01: repeat tombstone replay and purge converge without duplicate audit/outbox", async () => {
    const artifactStore = createTestArtifactStore();
    const student = await seedStudentUser(db, {
      username: `e01_idem_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });

    const created = await createExportJob(db, {
      requesterId: student.studentId,
      requesterRole: "student",
      studentId: student.studentId,
      idempotencyKey: "e01-export-idempotent",
    });

    await processExportJob(db, { jobId: created.jobId, artifactStore });
    const artifactKey = `export/${created.jobId}`;

    await executeStudentAccountDeletion(student.studentId, artifactStore);

    await db
      .update(exportJobs)
      .set({
        status: EXPORT_JOB_STATUS.READY,
        downloadTokenHash: "restored_token_hash_idem",
        artifactKey,
      })
      .where(eq(exportJobs.id, created.jobId));

    const restoredStore = createTestArtifactStore();
    await restoredStore.put(artifactKey, Buffer.from('{"canary":"idempotent"}', "utf8"));

    const auditBefore = await db.select().from(auditEvents);
    const outboxBefore = await db.select().from(outboxEvents);

    await applyTombstonesBeforeProjectionRebuild(db, { artifactStore: restoredStore });
    await applyTombstonesBeforeProjectionRebuild(db, { artifactStore: restoredStore });

    const auditAfter = await db.select().from(auditEvents);
    const outboxAfter = await db.select().from(outboxEvents);

    expect(auditAfter).toHaveLength(auditBefore.length);
    expect(outboxAfter).toHaveLength(outboxBefore.length);
    expect(restoredStore.has(artifactKey)).toBe(false);
  });
});
