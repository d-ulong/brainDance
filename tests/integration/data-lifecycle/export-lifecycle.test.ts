import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { auditEvents, exportJobs } from "@/db/schema";
import { hashDownloadToken } from "@/lib/crypto";
import { endRelationship } from "@/modules/family-access/end-relationship.service";
import { DataLifecycleError } from "@/modules/data-lifecycle/errors";
import {
  createExportJob,
  deliverExportDownload,
  issueExportDownloadToken,
  processExportJob,
} from "@/modules/data-lifecycle/export-job.service";
import {
  buildExportScopeSnapshot,
  scopeSnapshotContainsBody,
} from "@/modules/data-lifecycle/export-scope.service";
import { createDeletionRequest } from "@/modules/data-lifecycle/deletion-request.service";
import { DELETION_TARGET_TYPE } from "@/modules/data-lifecycle/constants";
import { revokePrivateAccess } from "@/modules/reflection-privacy/grant-private-access.service";
import {
  acceptParentForStudent,
  bootstrapVerifiedParentWithInvite,
  seedStudentUser,
} from "../../helpers/family-access";
import {
  createTestArtifactStore,
  seedPrivateReflection,
  seedSharedReflection,
} from "../../helpers/data-lifecycle";
import { closeTestDb, getTestDb, migrateTestDb, resetIdentityTables } from "../../helpers/db";

config({ path: ".env.local" });
config({ path: ".env" });

const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("M6 P2 export lifecycle", () => {
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

  it("AC-M6-03: student export scope includes all sections without body in snapshot", async () => {
    const student = await seedStudentUser(db, {
      username: `export_student_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });

    const scope = await buildExportScopeSnapshot(db, {
      requesterId: student.studentId,
      requesterRole: "student",
      studentId: student.studentId,
    });

    expect(scope.requesterRole).toBe("student");
    expect(scope.includedSections.length).toBeGreaterThan(0);
    expect(scopeSnapshotContainsBody(scope)).toBe(false);
  });

  it("AC-M6-03: parent export excludes private reflection without grant", async () => {
    const email = `parent_export_${crypto.randomUUID().slice(0, 8)}@test.local`;
    const { parentId } = await bootstrapVerifiedParentWithInvite(db, email);
    const student = await seedStudentUser(db, {
      username: `export_child_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });
    await acceptParentForStudent(db, { parentId, studentId: student.studentId });

    const secretBody = "super-secret-private-reflection-body";
    await seedPrivateReflection(db, {
      studentId: student.studentId,
      parentId,
      body: secretBody,
    });
    await seedSharedReflection(db, {
      studentId: student.studentId,
      body: "normal reflection visible",
    });

    const created = await createExportJob(db, {
      requesterId: parentId,
      requesterRole: "parent",
      studentId: student.studentId,
      idempotencyKey: "export-parent-1",
    });

    await processExportJob(db, {
      jobId: created.jobId,
      artifactStore,
    });

    const issued = await issueExportDownloadToken(db, {
      jobId: created.jobId,
      actor: { actorId: parentId, actorRole: "parent" },
    });

    const delivered = await deliverExportDownload(db, {
      jobId: created.jobId,
      tokenPlaintext: issued.token,
      artifactStore,
      actor: { actorId: parentId, actorRole: "parent" },
    });

    const artifact = JSON.parse(delivered.content.toString("utf8"));
    const reflections = artifact.sections.reflections as Array<{ body: string }>;
    expect(reflections.some((r) => r.body === secretBody)).toBe(false);
    expect(reflections.some((r) => r.body === "normal reflection visible")).toBe(true);
  });

  it("AC-M6-03: parent export excludes reflection after grant revoked at worker time", async () => {
    const email = `parent_revoke_${crypto.randomUUID().slice(0, 8)}@test.local`;
    const { parentId } = await bootstrapVerifiedParentWithInvite(db, email);
    const student = await seedStudentUser(db, {
      username: `revoke_child_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });
    await acceptParentForStudent(db, { parentId, studentId: student.studentId });

    const secretBody = "revoked-grant-body-content";
    const { familyDate } = await seedPrivateReflection(db, {
      studentId: student.studentId,
      parentId,
      body: secretBody,
    });

    const created = await createExportJob(db, {
      requesterId: parentId,
      requesterRole: "parent",
      studentId: student.studentId,
      idempotencyKey: "export-before-revoke",
    });

    await revokePrivateAccess(db, {
      studentId: student.studentId,
      parentId,
      familyDate,
      idempotencyKey: "revoke-grant-1",
    });

    await processExportJob(db, { jobId: created.jobId, artifactStore });
    const issued = await issueExportDownloadToken(db, {
      jobId: created.jobId,
      actor: { actorId: parentId, actorRole: "parent" },
    });
    const delivered = await deliverExportDownload(db, {
      jobId: created.jobId,
      tokenPlaintext: issued.token,
      artifactStore,
      actor: { actorId: parentId, actorRole: "parent" },
    });

    const artifact = JSON.parse(delivered.content.toString("utf8"));
    const reflections = artifact.sections.reflections as Array<{ body: string }>;
    expect(reflections.some((r) => r.body === secretBody)).toBe(false);
  });

  it("AC-M6-04: token stored as hash only; audit has no token plaintext", async () => {
    const student = await seedStudentUser(db, {
      username: `token_student_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });

    const created = await createExportJob(db, {
      requesterId: student.studentId,
      requesterRole: "student",
      studentId: student.studentId,
      idempotencyKey: "export-token-hash",
    });

    await processExportJob(db, {
      jobId: created.jobId,
      artifactStore,
    });

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
    expect(job!.downloadTokenHash).not.toBe(token);
    // The plaintext token is never persisted on the job row.
    expect(JSON.stringify(job)).not.toContain(token);

    const audits = await db.select().from(auditEvents);
    for (const audit of audits) {
      expect(JSON.stringify(audit)).not.toContain(token);
    }

    // No token plaintext is stored under any artifact-store key (F01 no-plaintext).
    expect(artifactStore.has(`export/${created.jobId}.download-token`)).toBe(false);
  });

  it("AC-M6-04: concurrent download consumes token once", async () => {
    const student = await seedStudentUser(db, {
      username: `concurrent_dl_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });

    const created = await createExportJob(db, {
      requesterId: student.studentId,
      requesterRole: "student",
      studentId: student.studentId,
      idempotencyKey: "export-concurrent-dl",
    });

    await processExportJob(db, { jobId: created.jobId, artifactStore });
    const issued = await issueExportDownloadToken(db, {
      jobId: created.jobId,
      actor: { actorId: student.studentId, actorRole: "student" },
    });
    const token = issued.token;

    const first = deliverExportDownload(db, {
      jobId: created.jobId,
      tokenPlaintext: token,
      artifactStore,
      actor: { actorId: student.studentId, actorRole: "student" },
    });

    const second = deliverExportDownload(db, {
      jobId: created.jobId,
      tokenPlaintext: token,
      artifactStore,
      actor: { actorId: student.studentId, actorRole: "student" },
    });

    const results = await Promise.allSettled([first, second]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
  });

  it("AC-M6-04: worker retry does not duplicate ready artifact", async () => {
    const student = await seedStudentUser(db, {
      username: `retry_export_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });

    const created = await createExportJob(db, {
      requesterId: student.studentId,
      requesterRole: "student",
      studentId: student.studentId,
      idempotencyKey: "export-retry",
    });

    const first = await processExportJob(db, { jobId: created.jobId, artifactStore });
    const second = await processExportJob(db, { jobId: created.jobId, artifactStore });

    expect(first.idempotentReplay).toBe(false);
    expect(second.idempotentReplay).toBe(true);

    const readyJobs = await db.select().from(exportJobs).where(eq(exportJobs.status, "ready"));

    expect(readyJobs.filter((j) => j.id === created.jobId)).toHaveLength(1);
  });

  it("AC-M6-03: frozen student blocks export download", async () => {
    const student = await seedStudentUser(db, {
      username: `frozen_export_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });

    const created = await createExportJob(db, {
      requesterId: student.studentId,
      requesterRole: "student",
      studentId: student.studentId,
      idempotencyKey: "export-before-freeze",
    });

    await processExportJob(db, { jobId: created.jobId, artifactStore });
    const issued = await issueExportDownloadToken(db, {
      jobId: created.jobId,
      actor: { actorId: student.studentId, actorRole: "student" },
    });

    await createDeletionRequest(db, {
      targetType: DELETION_TARGET_TYPE.STUDENT_ACCOUNT,
      targetId: student.studentId,
      requestedBy: student.studentId,
      requesterRole: "student",
      idempotencyKey: "freeze-for-export",
      artifactStore,
    });

    await expect(
      deliverExportDownload(db, {
        jobId: created.jobId,
        tokenPlaintext: issued.token,
        artifactStore,
        actor: { actorId: student.studentId, actorRole: "student" },
      }),
    ).rejects.toBeInstanceOf(DataLifecycleError);
  });

  it("AC-M6-03: ended relationship blocks parent export at scope build", async () => {
    const email = `ended_parent_${crypto.randomUUID().slice(0, 8)}@test.local`;
    const { parentId } = await bootstrapVerifiedParentWithInvite(db, email);
    const student = await seedStudentUser(db, {
      username: `ended_child_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });
    const accepted = await acceptParentForStudent(db, { parentId, studentId: student.studentId });

    await endRelationship(db, {
      actorId: parentId,
      relationshipId: accepted.relationshipId,
      idempotencyKey: "end-rel-for-export",
    });

    await expect(
      buildExportScopeSnapshot(db, {
        requesterId: parentId,
        requesterRole: "parent",
        studentId: student.studentId,
      }),
    ).rejects.toThrow();
  });
});
