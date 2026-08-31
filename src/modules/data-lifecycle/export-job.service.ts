import { and, eq, isNull, sql } from "drizzle-orm";

import type { Database } from "@/db";
import {
  auditEvents,
  dailyReflections,
  exportJobs,
  pointBalanceProjection,
  pointLedgerEntries,
  pointRedemptions,
  privateAccessGrants,
  users,
} from "@/db/schema";
import { appendAuditEvent } from "@/modules/audit/append-audit-event";
import {
  EXPORT_JOB_STATUS,
  EXPORT_TOKEN_TTL_MS,
  type ExportScopeSnapshot,
} from "@/modules/data-lifecycle/constants";
import { DataLifecycleError } from "@/modules/data-lifecycle/errors";
import { buildExportScopeSnapshot } from "@/modules/data-lifecycle/export-scope.service";
import { assertStudentAccountNotFrozen } from "@/modules/data-lifecycle/freeze-guard.service";
import { appendOutboxEvent } from "@/modules/outbox/append-outbox-event";
import { hashIdempotencyPayload } from "@/modules/schedule/normalize-idempotency-payload";
import { generateDownloadTokenPlaintext, hashDownloadToken } from "@/lib/crypto";
import { PRIVATE_RESOURCE_TYPES } from "@/modules/reflection-privacy/constants";

export type CreateExportJobInput = {
  requesterId: string;
  requesterRole: "student" | "parent";
  studentId: string;
  idempotencyKey: string;
  requestId?: string;
};

export type CreateExportJobResult = {
  jobId: string;
  status: string;
  idempotentReplay: boolean;
};

export type ExportJobDto = {
  id: string;
  requesterId: string;
  studentId: string;
  status: string;
  readyAt: Date | null;
  expiresAt: Date | null;
  consumedAt: Date | null;
  createdAt: Date;
};

function toExportJobDto(row: typeof exportJobs.$inferSelect): ExportJobDto {
  return {
    id: row.id,
    requesterId: row.requesterId,
    studentId: row.studentId,
    status: row.status,
    readyAt: row.readyAt,
    expiresAt: row.expiresAt,
    consumedAt: row.consumedAt,
    createdAt: row.createdAt,
  };
}

async function findCreateReplay(
  db: Database,
  requesterId: string,
  idempotencyKey: string,
): Promise<string | null> {
  const auditKey = `audit:export.create:${requesterId}:${idempotencyKey}`;
  const [existing] = await db
    .select({ resourceId: auditEvents.resourceId })
    .from(auditEvents)
    .where(eq(auditEvents.idempotencyKey, auditKey))
    .limit(1);

  return existing?.resourceId ?? null;
}

export async function createExportJob(
  db: Database,
  input: CreateExportJobInput,
): Promise<CreateExportJobResult> {
  const replayId = await findCreateReplay(db, input.requesterId, input.idempotencyKey);
  if (replayId) {
    return { jobId: replayId, status: EXPORT_JOB_STATUS.PENDING, idempotentReplay: true };
  }

  const scope = await buildExportScopeSnapshot(db, {
    requesterId: input.requesterId,
    requesterRole: input.requesterRole,
    studentId: input.studentId,
  });

  const payloadHash = hashIdempotencyPayload({
    studentId: input.studentId,
    requesterRole: input.requesterRole,
  });

  return db.transaction(async (tx) => {
    const replayInTx = await findCreateReplay(tx, input.requesterId, input.idempotencyKey);
    if (replayInTx) {
      return { jobId: replayInTx, status: EXPORT_JOB_STATUS.PENDING, idempotentReplay: true };
    }

    const now = new Date();

    const [job] = await tx
      .insert(exportJobs)
      .values({
        requesterId: input.requesterId,
        studentId: input.studentId,
        scopeSnapshot: scope as unknown as Record<string, unknown>,
        status: EXPORT_JOB_STATUS.PENDING,
        createIdempotencyKey: input.idempotencyKey,
        createIdempotencyPayloadHash: payloadHash,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: exportJobs.id });

    if (!job) {
      throw new DataLifecycleError("STATE_CONFLICT", "Failed to create export job");
    }

    await appendAuditEvent(tx, {
      actorId: input.requesterId,
      action: "export.create",
      resourceType: "export_job",
      resourceId: job.id,
      requestId: input.requestId,
      idempotencyKey: `audit:export.create:${input.requesterId}:${input.idempotencyKey}`,
      metadata: {
        studentId: input.studentId,
        requesterRole: input.requesterRole,
        schemaVersion: scope.schemaVersion,
      },
    });

    await appendOutboxEvent(tx, {
      aggregateType: "export_job",
      aggregateId: job.id,
      eventType: "export.requested",
      dedupeKey: `outbox:export.create:${input.requesterId}:${input.idempotencyKey}`,
      payload: {
        jobId: job.id,
        studentId: input.studentId,
        requesterId: input.requesterId,
      },
    });

    return { jobId: job.id, status: EXPORT_JOB_STATUS.PENDING, idempotentReplay: false };
  });
}

export async function listExportJobsForRequester(
  db: Database,
  requesterId: string,
): Promise<ExportJobDto[]> {
  const rows = await db
    .select()
    .from(exportJobs)
    .where(eq(exportJobs.requesterId, requesterId))
    .orderBy(exportJobs.createdAt);

  return rows.map(toExportJobDto);
}

export async function getExportJob(
  db: Database,
  jobId: string,
): Promise<typeof exportJobs.$inferSelect | null> {
  const [row] = await db.select().from(exportJobs).where(eq(exportJobs.id, jobId)).limit(1);
  return row ?? null;
}

export type ProcessExportJobInput = {
  jobId: string;
  artifactStore: import("@/modules/data-lifecycle/private-artifact-store").PrivateArtifactStore;
  now?: Date;
};

export type ProcessExportJobResult = {
  jobId: string;
  status: string;
  downloadTokenPlaintext?: string;
  idempotentReplay: boolean;
};

async function buildExportArtifactContent(
  db: Database,
  scope: ExportScopeSnapshot,
  requesterId: string,
): Promise<Record<string, unknown>> {
  const [profile] = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      username: users.username,
      birthDate: users.birthDate,
    })
    .from(users)
    .where(eq(users.id, scope.studentId))
    .limit(1);

  const artifact: Record<string, unknown> = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    studentId: scope.studentId,
    sections: {},
  };

  if (scope.includedSections.includes("profile") && profile) {
    (artifact.sections as Record<string, unknown>).profile = {
      displayName: profile.displayName,
      username: profile.username,
      birthDate: profile.birthDate,
    };
  }

  if (scope.includedSections.includes("ledger")) {
    const [balance] = await db
      .select()
      .from(pointBalanceProjection)
      .where(eq(pointBalanceProjection.studentId, scope.studentId))
      .limit(1);

    const ledger = await db
      .select({
        id: pointLedgerEntries.id,
        amount: pointLedgerEntries.amount,
        reason: pointLedgerEntries.reason,
        sourceType: pointLedgerEntries.sourceType,
        createdAt: pointLedgerEntries.createdAt,
      })
      .from(pointLedgerEntries)
      .where(eq(pointLedgerEntries.studentId, scope.studentId));

    (artifact.sections as Record<string, unknown>).ledger = {
      balance: balance?.balance ?? 0,
      entries: ledger,
    };
  }

  if (scope.includedSections.includes("reflections")) {
    const reflections = await db
      .select({
        id: dailyReflections.id,
        familyDate: dailyReflections.familyDate,
        visibility: dailyReflections.visibility,
        body: dailyReflections.body,
      })
      .from(dailyReflections)
      .where(
        and(eq(dailyReflections.studentId, scope.studentId), isNull(dailyReflections.deletedAt)),
      );

    const includedReflections = [];

    for (const reflection of reflections) {
      if (scope.requesterRole === "student") {
        includedReflections.push({
          id: reflection.id,
          familyDate: reflection.familyDate,
          visibility: reflection.visibility,
          body: reflection.body,
        });
        continue;
      }

      if (reflection.visibility === "normal") {
        includedReflections.push({
          id: reflection.id,
          familyDate: reflection.familyDate,
          visibility: reflection.visibility,
          body: reflection.body,
        });
        continue;
      }

      const [grant] = await db
        .select({ id: privateAccessGrants.id })
        .from(privateAccessGrants)
        .where(
          and(
            eq(privateAccessGrants.resourceId, reflection.id),
            eq(privateAccessGrants.resourceType, PRIVATE_RESOURCE_TYPES.DAILY_REFLECTION),
            eq(privateAccessGrants.parentId, requesterId),
            isNull(privateAccessGrants.revokedAt),
          ),
        )
        .limit(1);

      if (grant && scope.privateGrantIds.includes(grant.id)) {
        includedReflections.push({
          id: reflection.id,
          familyDate: reflection.familyDate,
          visibility: reflection.visibility,
          body: reflection.body,
        });
      }
    }

    (artifact.sections as Record<string, unknown>).reflections = includedReflections;
  }

  if (scope.includedSections.includes("redemptions")) {
    const redemptions = await db
      .select({
        id: pointRedemptions.id,
        status: pointRedemptions.status,
        costSnapshot: pointRedemptions.costSnapshot,
        requestMonth: pointRedemptions.requestMonth,
      })
      .from(pointRedemptions)
      .where(eq(pointRedemptions.studentId, scope.studentId));

    (artifact.sections as Record<string, unknown>).redemptions = redemptions;
  }

  return artifact;
}

export async function processExportJob(
  db: Database,
  input: ProcessExportJobInput,
): Promise<ProcessExportJobResult> {
  const now = input.now ?? new Date();

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM export_jobs WHERE id = ${input.jobId}::uuid FOR UPDATE`);

    const [job] = await tx.select().from(exportJobs).where(eq(exportJobs.id, input.jobId)).limit(1);

    if (!job) {
      throw new DataLifecycleError("NOT_FOUND", "Export job not found");
    }

    if (job.status === EXPORT_JOB_STATUS.READY && job.downloadTokenHash) {
      return { jobId: job.id, status: job.status, idempotentReplay: true };
    }

    if (job.status !== EXPORT_JOB_STATUS.PENDING && job.status !== EXPORT_JOB_STATUS.PROCESSING) {
      throw new DataLifecycleError("STATE_CONFLICT", "Export job is not processable");
    }

    await assertStudentAccountNotFrozen(tx, job.studentId);

    const scope = job.scopeSnapshot as unknown as ExportScopeSnapshot;
    const { validateExportScopeStillAuthorized } =
      await import("@/modules/data-lifecycle/export-scope.service");
    await validateExportScopeStillAuthorized(tx, scope, job.requesterId);

    await tx
      .update(exportJobs)
      .set({ status: EXPORT_JOB_STATUS.PROCESSING, updatedAt: now })
      .where(eq(exportJobs.id, job.id));

    const content = await buildExportArtifactContent(tx, scope, job.requesterId);
    const artifactKey = `export/${job.id}`;
    const artifactBuffer = Buffer.from(JSON.stringify(content), "utf8");

    await input.artifactStore.put(artifactKey, artifactBuffer);

    const downloadTokenPlaintext = generateDownloadTokenPlaintext();
    const downloadTokenHash = hashDownloadToken(downloadTokenPlaintext);
    const expiresAt = new Date(now.getTime() + EXPORT_TOKEN_TTL_MS);

    await tx
      .update(exportJobs)
      .set({
        status: EXPORT_JOB_STATUS.READY,
        artifactKey,
        downloadTokenHash,
        expiresAt,
        readyAt: now,
        updatedAt: now,
      })
      .where(eq(exportJobs.id, job.id));

    await appendAuditEvent(tx, {
      actorId: job.requesterId,
      action: "export.ready",
      resourceType: "export_job",
      resourceId: job.id,
      idempotencyKey: `audit:export.ready:${job.id}`,
      metadata: { studentId: job.studentId },
    });

    return {
      jobId: job.id,
      status: EXPORT_JOB_STATUS.READY,
      downloadTokenPlaintext,
      idempotentReplay: false,
    };
  });
}

export type DeliverExportDownloadInput = {
  jobId: string;
  tokenPlaintext: string;
  artifactStore: import("@/modules/data-lifecycle/private-artifact-store").PrivateArtifactStore;
  now?: Date;
};

export type DeliverExportDownloadResult = {
  content: Buffer;
  consumedAt: Date;
  idempotentReplay: boolean;
};

export async function deliverExportDownload(
  db: Database,
  input: DeliverExportDownloadInput,
): Promise<DeliverExportDownloadResult> {
  const now = input.now ?? new Date();
  const tokenHash = hashDownloadToken(input.tokenPlaintext);

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM export_jobs WHERE id = ${input.jobId}::uuid FOR UPDATE`);

    const [job] = await tx.select().from(exportJobs).where(eq(exportJobs.id, input.jobId)).limit(1);

    if (!job) {
      throw new DataLifecycleError("NOT_FOUND", "Export job not found");
    }

    if (job.downloadTokenHash !== tokenHash) {
      throw new DataLifecycleError("TOKEN_INVALID", "Download token is invalid");
    }

    const { assertExportJobAccessible } =
      await import("@/modules/data-lifecycle/freeze-guard.service");
    await assertExportJobAccessible(tx, job);

    if (job.consumedAt) {
      throw new DataLifecycleError("TOKEN_CONSUMED", "Download token has already been consumed");
    }

    if (!job.artifactKey) {
      throw new DataLifecycleError("ARTIFACT_UNAVAILABLE", "Export artifact is not ready");
    }

    const content = await input.artifactStore.openOnce(job.artifactKey);
    if (!content) {
      throw new DataLifecycleError(
        "ARTIFACT_UNAVAILABLE",
        "Export artifact is no longer available",
      );
    }

    await tx
      .update(exportJobs)
      .set({ consumedAt: now, updatedAt: now })
      .where(eq(exportJobs.id, job.id));

    await appendAuditEvent(tx, {
      actorId: job.requesterId,
      action: "export.download",
      resourceType: "export_job",
      resourceId: job.id,
      idempotencyKey: `audit:export.download:${job.id}`,
      metadata: { studentId: job.studentId },
    });

    return { content, consumedAt: now, idempotentReplay: false };
  });
}
