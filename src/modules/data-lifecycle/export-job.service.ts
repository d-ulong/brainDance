import { and, eq, isNull, sql } from "drizzle-orm";

import type { Database } from "@/db";
import {
  dailyReflections,
  exportJobs,
  pointBalanceProjection,
  pointLedgerEntries,
  pointRedemptions,
  privateAccessGrants,
  scheduleItems,
  trainingMetrics,
  trainingSessions,
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
import { isPostgresUniqueViolation } from "@/lib/postgres-errors";
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

export type ExportJobActor = {
  actorId: string;
  actorRole: "student" | "parent" | "admin";
};

function assertExportJobActorCanAccess(
  job: typeof exportJobs.$inferSelect,
  actor: ExportJobActor,
): void {
  if (actor.actorRole === "admin") {
    return;
  }

  if (job.requesterId !== actor.actorId) {
    throw new DataLifecycleError("NOT_FOUND", "Export job not found");
  }
}

export function exportArtifactKey(jobId: string): string {
  return `export/${jobId}`;
}

function exportArtifactStagingKey(jobId: string): string {
  return `${exportArtifactKey(jobId)}.staging`;
}

export function exportArtifactRelatedKeys(jobId: string, artifactKey?: string | null): string[] {
  const keys = [exportArtifactKey(jobId), exportArtifactStagingKey(jobId)];
  if (artifactKey && !keys.includes(artifactKey)) {
    keys.push(artifactKey);
    keys.push(`${artifactKey}.staging`);
  }
  return keys;
}

async function markExportJobFailed(
  db: Database,
  jobId: string,
  artifactStore: import("@/modules/data-lifecycle/private-artifact-store").PrivateArtifactStore,
): Promise<void> {
  const now = new Date();
  await db
    .update(exportJobs)
    .set({
      status: EXPORT_JOB_STATUS.FAILED,
      artifactKey: null,
      downloadTokenHash: null,
      expiresAt: null,
      updatedAt: now,
    })
    .where(eq(exportJobs.id, jobId));

  for (const key of exportArtifactRelatedKeys(jobId)) {
    await artifactStore.purge(key);
  }
}

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

export async function createExportJob(
  db: Database,
  input: CreateExportJobInput,
): Promise<CreateExportJobResult> {
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
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`export.create:${input.requesterId}:${input.idempotencyKey}`}))`,
    );

    const [existingInTx] = await tx
      .select()
      .from(exportJobs)
      .where(
        and(
          eq(exportJobs.requesterId, input.requesterId),
          eq(exportJobs.createIdempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);

    if (existingInTx) {
      if (existingInTx.createIdempotencyPayloadHash !== payloadHash) {
        throw new DataLifecycleError("IDEMPOTENCY_CONFLICT", "Export job idempotency conflict");
      }
      return {
        jobId: existingInTx.id,
        status: existingInTx.status,
        idempotentReplay: true,
      };
    }

    const now = new Date();

    let inserted: Array<{ id: string }> = [];

    try {
      inserted = await tx
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
        .onConflictDoNothing({
          target: [exportJobs.requesterId, exportJobs.createIdempotencyKey],
        })
        .returning({ id: exportJobs.id });
    } catch (error) {
      if (!isPostgresUniqueViolation(error)) {
        throw error;
      }
    }

    const job = inserted[0];

    if (job) {
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
    }

    const [replay] = await tx
      .select()
      .from(exportJobs)
      .where(
        and(
          eq(exportJobs.requesterId, input.requesterId),
          eq(exportJobs.createIdempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);

    if (!replay) {
      throw new DataLifecycleError("STATE_CONFLICT", "Failed to create export job");
    }

    if (replay.createIdempotencyPayloadHash !== payloadHash) {
      throw new DataLifecycleError("IDEMPOTENCY_CONFLICT", "Export job idempotency conflict");
    }

    return { jobId: replay.id, status: replay.status, idempotentReplay: true };
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

export async function getExportJobStatusForActor(
  db: Database,
  jobId: string,
  actor: ExportJobActor,
): Promise<ExportJobDto> {
  const job = await getExportJob(db, jobId);
  if (!job) {
    throw new DataLifecycleError("NOT_FOUND", "Export job not found");
  }

  assertExportJobActorCanAccess(job, actor);
  return toExportJobDto(job);
}

export type ProcessExportJobInput = {
  jobId: string;
  artifactStore: import("@/modules/data-lifecycle/private-artifact-store").PrivateArtifactStore;
  now?: Date;
};

export type ProcessExportJobResult = {
  jobId: string;
  status: string;
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

  if (scope.includedSections.includes("schedule")) {
    const items = await db
      .select({
        id: scheduleItems.id,
        familyDate: scheduleItems.familyDate,
        status: scheduleItems.status,
        scheduledAt: scheduleItems.scheduledAt,
        planId: scheduleItems.planId,
        occurrenceKey: scheduleItems.occurrenceKey,
      })
      .from(scheduleItems)
      .where(eq(scheduleItems.studentId, scope.studentId));

    (artifact.sections as Record<string, unknown>).schedule = items;
  }

  if (scope.includedSections.includes("training_summary")) {
    const sessions = await db
      .select({
        id: trainingSessions.id,
        trainingKey: trainingSessions.trainingKey,
        status: trainingSessions.status,
        sessionKind: trainingSessions.sessionKind,
        familyDate: trainingSessions.familyDate,
        startedAt: trainingSessions.startedAt,
        finishedAt: trainingSessions.finishedAt,
      })
      .from(trainingSessions)
      .where(eq(trainingSessions.studentId, scope.studentId));

    const sessionSummaries = [];

    for (const session of sessions) {
      const metrics = await db
        .select({
          metricKey: trainingMetrics.metricKey,
          value: trainingMetrics.value,
          unit: trainingMetrics.unit,
        })
        .from(trainingMetrics)
        .where(eq(trainingMetrics.sessionId, session.id));

      sessionSummaries.push({
        ...session,
        metrics,
      });
    }

    (artifact.sections as Record<string, unknown>).training_summary = sessionSummaries;
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

  type PreparedWork = {
    jobId: string;
    status: string;
    idempotentReplay: boolean;
    artifactKey?: string;
    artifactBuffer?: Buffer;
  };

  const prepared = await db.transaction(async (tx): Promise<PreparedWork> => {
    await tx.execute(sql`SELECT id FROM export_jobs WHERE id = ${input.jobId}::uuid FOR UPDATE`);

    const [job] = await tx.select().from(exportJobs).where(eq(exportJobs.id, input.jobId)).limit(1);

    if (!job) {
      throw new DataLifecycleError("NOT_FOUND", "Export job not found");
    }

    if (job.status === EXPORT_JOB_STATUS.READY) {
      return {
        jobId: job.id,
        status: job.status,
        idempotentReplay: true,
      };
    }

    if (
      job.status === EXPORT_JOB_STATUS.FAILED ||
      job.status === EXPORT_JOB_STATUS.REVOKED ||
      job.status === EXPORT_JOB_STATUS.EXPIRED
    ) {
      throw new DataLifecycleError("STATE_CONFLICT", "Export job is not processable");
    }

    if (job.status !== EXPORT_JOB_STATUS.PENDING && job.status !== EXPORT_JOB_STATUS.PROCESSING) {
      throw new DataLifecycleError("STATE_CONFLICT", "Export job is not processable");
    }

    await assertStudentAccountNotFrozen(tx, job.studentId);

    const scope = job.scopeSnapshot as unknown as ExportScopeSnapshot;
    const { validateExportScopeStillAuthorized } =
      await import("@/modules/data-lifecycle/export-scope.service");
    await validateExportScopeStillAuthorized(tx, scope, job.requesterId);

    if (job.status === EXPORT_JOB_STATUS.PENDING) {
      await tx
        .update(exportJobs)
        .set({ status: EXPORT_JOB_STATUS.PROCESSING, updatedAt: now })
        .where(eq(exportJobs.id, job.id));
    }

    const content = await buildExportArtifactContent(tx, scope, job.requesterId);
    const artifactKey = exportArtifactKey(job.id);
    const artifactBuffer = Buffer.from(JSON.stringify(content), "utf8");

    return {
      jobId: job.id,
      status: EXPORT_JOB_STATUS.PROCESSING,
      idempotentReplay: false,
      artifactKey,
      artifactBuffer,
    };
  });

  if (prepared.idempotentReplay) {
    return {
      jobId: prepared.jobId,
      status: prepared.status,
      idempotentReplay: true,
    };
  }

  try {
    await input.artifactStore.put(prepared.artifactKey!, prepared.artifactBuffer!);
  } catch (error) {
    await markExportJobFailed(db, prepared.jobId, input.artifactStore);
    throw error;
  }

  try {
    const finalized = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM export_jobs WHERE id = ${input.jobId}::uuid FOR UPDATE`);

      const [job] = await tx
        .select()
        .from(exportJobs)
        .where(eq(exportJobs.id, input.jobId))
        .limit(1);

      if (!job) {
        throw new DataLifecycleError("NOT_FOUND", "Export job not found");
      }

      if (job.status === EXPORT_JOB_STATUS.READY) {
        return { idempotentReplay: true as const, status: job.status };
      }

      if (job.status !== EXPORT_JOB_STATUS.PROCESSING) {
        throw new DataLifecycleError("STATE_CONFLICT", "Export job finalize state conflict");
      }

      await tx
        .update(exportJobs)
        .set({
          status: EXPORT_JOB_STATUS.READY,
          artifactKey: prepared.artifactKey!,
          downloadTokenHash: null,
          expiresAt: null,
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

      return { idempotentReplay: false as const, status: EXPORT_JOB_STATUS.READY };
    });

    return {
      jobId: prepared.jobId,
      status: finalized.status,
      idempotentReplay: finalized.idempotentReplay,
    };
  } catch (error) {
    await input.artifactStore.purge(prepared.artifactKey!);
    await markExportJobFailed(db, prepared.jobId, input.artifactStore);
    throw error;
  }
}

export type IssueExportDownloadTokenInput = {
  jobId: string;
  actor: ExportJobActor;
  now?: Date;
};

export type IssueExportDownloadTokenResult = {
  token: string;
  expiresAt: Date;
};

/**
 * Authorization-gated download-token issuance.
 *
 * The plaintext token is generated and returned to the caller exactly once and is
 * never persisted: only the HMAC hash is stored on the job row, and each issuance
 * rotates the stored hash so a lost/failed response can be safely retried. The
 * job must be READY with the artifact present; freeze/revocation/consumption and
 * 24h expiry are enforced here and again at download time (second authorization).
 */
export async function issueExportDownloadToken(
  db: Database,
  input: IssueExportDownloadTokenInput,
): Promise<IssueExportDownloadTokenResult> {
  const now = input.now ?? new Date();
  const token = generateDownloadTokenPlaintext();
  const tokenHash = hashDownloadToken(token);
  const expiresAt = new Date(now.getTime() + EXPORT_TOKEN_TTL_MS);

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM export_jobs WHERE id = ${input.jobId}::uuid FOR UPDATE`);

    const [job] = await tx.select().from(exportJobs).where(eq(exportJobs.id, input.jobId)).limit(1);

    if (!job) {
      throw new DataLifecycleError("NOT_FOUND", "Export job not found");
    }

    assertExportJobActorCanAccess(job, input.actor);

    const { assertExportJobAccessible } =
      await import("@/modules/data-lifecycle/freeze-guard.service");
    await assertExportJobAccessible(tx, job);

    if (job.status !== EXPORT_JOB_STATUS.READY) {
      throw new DataLifecycleError("ARTIFACT_UNAVAILABLE", "Export artifact is not ready");
    }

    await tx
      .update(exportJobs)
      .set({ downloadTokenHash: tokenHash, expiresAt, updatedAt: now })
      .where(eq(exportJobs.id, job.id));

    await appendAuditEvent(tx, {
      actorId: input.actor.actorId,
      action: "export.token_issued",
      resourceType: "export_job",
      resourceId: job.id,
      idempotencyKey: `audit:export.token_issued:${job.id}:${crypto.randomUUID()}`,
      metadata: { studentId: job.studentId },
    });
  });

  return { token, expiresAt };
}

export type DeliverExportDownloadInput = {
  jobId: string;
  tokenPlaintext: string;
  artifactStore: import("@/modules/data-lifecycle/private-artifact-store").PrivateArtifactStore;
  actor: ExportJobActor;
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

    assertExportJobActorCanAccess(job, input.actor);

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
      actorId: input.actor.actorId,
      action: "export.download",
      resourceType: "export_job",
      resourceId: job.id,
      idempotencyKey: `audit:export.download:${job.id}`,
      metadata: { studentId: job.studentId },
    });

    return { content, consumedAt: now, idempotentReplay: false };
  });
}
