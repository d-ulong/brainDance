import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { auditEvents, exportJobs } from "@/db/schema";
import { hashDownloadToken } from "@/lib/crypto";
import { DataLifecycleError } from "@/modules/data-lifecycle/errors";
import { EXPORT_JOB_STATUS } from "@/modules/data-lifecycle/constants";
import {
  createExportJob,
  deliverExportDownload,
  issueExportDownloadToken,
  processExportJob,
} from "@/modules/data-lifecycle/export-job.service";
import { createDeletionRequest } from "@/modules/data-lifecycle/deletion-request.service";
import { DELETION_TARGET_TYPE } from "@/modules/data-lifecycle/constants";
import { seedStudentUser } from "../../helpers/family-access";
import { createTestArtifactStore } from "../../helpers/data-lifecycle";
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

describe.skipIf(!hasDb)("M6 P3 F01 ready/token delivery convergence", () => {
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

  async function seedStudent() {
    return seedStudentUser(db, {
      username: `f01_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });
  }

  it("F01: READY job is always recoverable via on-demand token issuance (no token-delivery crash point)", async () => {
    const student = await seedStudent();

    const created = await createExportJob(db, {
      requesterId: student.studentId,
      requesterRole: "student",
      studentId: student.studentId,
      idempotencyKey: "f01-ready-recoverable",
    });

    await processExportJob(db, { jobId: created.jobId, artifactStore });

    const [job] = await db
      .select()
      .from(exportJobs)
      .where(eq(exportJobs.id, created.jobId))
      .limit(1);
    expect(job!.status).toBe(EXPORT_JOB_STATUS.READY);

    // No token-delivery artifact is ever written (plaintext never persisted).
    expect(artifactStore.has(`export/${created.jobId}.download-token`)).toBe(false);

    // The job is downloadable: token issued on demand, then consumed by download.
    const issued = await issueExportDownloadToken(db, {
      jobId: created.jobId,
      actor: { actorId: student.studentId, actorRole: "student" },
    });
    const delivered = await deliverExportDownload(db, {
      jobId: created.jobId,
      tokenPlaintext: issued.token,
      artifactStore,
      actor: { actorId: student.studentId, actorRole: "student" },
    });
    expect(delivered.content.byteLength).toBeGreaterThan(0);
  });

  it("F01: interrupted processing (crash after put before finalize) converges on replay", async () => {
    const student = await seedStudent();

    const created = await createExportJob(db, {
      requesterId: student.studentId,
      requesterRole: "student",
      studentId: student.studentId,
      idempotencyKey: "f01-replay-converge",
    });

    // Simulate a crash right after the artifact put but before the finalize commit.
    await db
      .update(exportJobs)
      .set({ status: EXPORT_JOB_STATUS.PROCESSING })
      .where(eq(exportJobs.id, created.jobId));

    const replayed = await processExportJob(db, { jobId: created.jobId, artifactStore });
    expect(replayed.idempotentReplay).toBe(false);
    expect(replayed.status).toBe(EXPORT_JOB_STATUS.READY);

    // A further replay is an idempotent no-op that leaves the job downloadable.
    const again = await processExportJob(db, { jobId: created.jobId, artifactStore });
    expect(again.idempotentReplay).toBe(true);

    const issued = await issueExportDownloadToken(db, {
      jobId: created.jobId,
      actor: { actorId: student.studentId, actorRole: "student" },
    });
    const delivered = await deliverExportDownload(db, {
      jobId: created.jobId,
      tokenPlaintext: issued.token,
      artifactStore,
      actor: { actorId: student.studentId, actorRole: "student" },
    });
    expect(delivered.content.byteLength).toBeGreaterThan(0);
  });

  it("F01: processExportJob replay on a READY job never re-writes or rotates state", async () => {
    const student = await seedStudent();

    const created = await createExportJob(db, {
      requesterId: student.studentId,
      requesterRole: "student",
      studentId: student.studentId,
      idempotencyKey: "f01-ready-replay",
    });

    await processExportJob(db, { jobId: created.jobId, artifactStore });

    const issued = await issueExportDownloadToken(db, {
      jobId: created.jobId,
      actor: { actorId: student.studentId, actorRole: "student" },
    });

    // Replaying the worker on a READY job must not invalidate the issued token.
    const replay = await processExportJob(db, { jobId: created.jobId, artifactStore });
    expect(replay.idempotentReplay).toBe(true);

    const delivered = await deliverExportDownload(db, {
      jobId: created.jobId,
      tokenPlaintext: issued.token,
      artifactStore,
      actor: { actorId: student.studentId, actorRole: "student" },
    });
    expect(delivered.content.byteLength).toBeGreaterThan(0);
  });

  it("F01: no plaintext token is persisted in DB, audit, or artifact store", async () => {
    const student = await seedStudent();

    const created = await createExportJob(db, {
      requesterId: student.studentId,
      requesterRole: "student",
      studentId: student.studentId,
      idempotencyKey: "f01-no-plaintext",
    });

    await processExportJob(db, { jobId: created.jobId, artifactStore });
    const issued = await issueExportDownloadToken(db, {
      jobId: created.jobId,
      actor: { actorId: student.studentId, actorRole: "student" },
    });
    const token = issued.token;

    const [job] = await db
      .select()
      .from(exportJobs)
      .where(eq(exportJobs.id, created.jobId))
      .limit(1);
    expect(job!.downloadTokenHash).toBe(hashDownloadToken(token));
    expect(JSON.stringify(job)).not.toContain(token);

    const audits = await db.select().from(auditEvents);
    for (const audit of audits) {
      expect(JSON.stringify(audit)).not.toContain(token);
    }

    expect(artifactStore.has(`export/${created.jobId}.download-token`)).toBe(false);
  });

  it("F01: concurrent issuance is safe (last rotation wins; consumed token cannot rotate)", async () => {
    const student = await seedStudent();

    const created = await createExportJob(db, {
      requesterId: student.studentId,
      requesterRole: "student",
      studentId: student.studentId,
      idempotencyKey: "f01-concurrent-issue",
    });
    await processExportJob(db, { jobId: created.jobId, artifactStore });

    const connA = createIndependentTestDb();
    const connB = createIndependentTestDb();

    try {
      const [a, b] = await Promise.all([
        issueExportDownloadToken(connA.db, {
          jobId: created.jobId,
          actor: { actorId: student.studentId, actorRole: "student" },
        }),
        issueExportDownloadToken(connB.db, {
          jobId: created.jobId,
          actor: { actorId: student.studentId, actorRole: "student" },
        }),
      ]);

      const [job] = await db
        .select()
        .from(exportJobs)
        .where(eq(exportJobs.id, created.jobId))
        .limit(1);

      // Both issuances succeeded; only the last-committed hash remains valid.
      const hashes = [hashDownloadToken(a.token), hashDownloadToken(b.token)];
      expect(hashes).toContain(job!.downloadTokenHash);

      // Exactly one of the two plaintext tokens downloads successfully.
      const results = await Promise.allSettled([
        deliverExportDownload(db, {
          jobId: created.jobId,
          tokenPlaintext: a.token,
          artifactStore,
          actor: { actorId: student.studentId, actorRole: "student" },
        }),
        deliverExportDownload(db, {
          jobId: created.jobId,
          tokenPlaintext: b.token,
          artifactStore,
          actor: { actorId: student.studentId, actorRole: "student" },
        }),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);

      // After consumption, issuance fails safely with TOKEN_CONSUMED.
      await expect(
        issueExportDownloadToken(db, {
          jobId: created.jobId,
          actor: { actorId: student.studentId, actorRole: "student" },
        }),
      ).rejects.toMatchObject({ code: "TOKEN_CONSUMED" });
    } finally {
      await connA.close();
      await connB.close();
    }
  });

  it("F01: issuance is authorization-gated and fail-closed on terminal/frozen/expired", async () => {
    const student = await seedStudent();
    const other = await seedStudentUser(db, {
      username: `f01_other_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });

    const created = await createExportJob(db, {
      requesterId: student.studentId,
      requesterRole: "student",
      studentId: student.studentId,
      idempotencyKey: "f01-issued-guard",
    });

    // Non-owner gets NOT_FOUND before the job is even ready.
    await expect(
      issueExportDownloadToken(db, {
        jobId: created.jobId,
        actor: { actorId: other.studentId, actorRole: "student" },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await processExportJob(db, { jobId: created.jobId, artifactStore });

    // Expired job refuses issuance.
    await db
      .update(exportJobs)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(exportJobs.id, created.jobId));
    await expect(
      issueExportDownloadToken(db, {
        jobId: created.jobId,
        actor: { actorId: student.studentId, actorRole: "student" },
      }),
    ).rejects.toMatchObject({ code: "TOKEN_EXPIRED" });

    // Revoked job refuses issuance.
    await db
      .update(exportJobs)
      .set({ status: EXPORT_JOB_STATUS.REVOKED, expiresAt: null })
      .where(eq(exportJobs.id, created.jobId));
    await expect(
      issueExportDownloadToken(db, {
        jobId: created.jobId,
        actor: { actorId: student.studentId, actorRole: "student" },
      }),
    ).rejects.toMatchObject({ code: "ARTIFACT_UNAVAILABLE" });
  });

  it("F01: frozen student cannot issue a download token", async () => {
    const student = await seedStudent();

    const created = await createExportJob(db, {
      requesterId: student.studentId,
      requesterRole: "student",
      studentId: student.studentId,
      idempotencyKey: "f01-frozen-issue",
    });
    await processExportJob(db, { jobId: created.jobId, artifactStore });

    await createDeletionRequest(db, {
      targetType: DELETION_TARGET_TYPE.STUDENT_ACCOUNT,
      targetId: student.studentId,
      requestedBy: student.studentId,
      requesterRole: "student",
      idempotencyKey: "f01-freeze",
      artifactStore,
    });

    await expect(
      issueExportDownloadToken(db, {
        jobId: created.jobId,
        actor: { actorId: student.studentId, actorRole: "student" },
      }),
    ).rejects.toBeInstanceOf(DataLifecycleError);
  });
});
