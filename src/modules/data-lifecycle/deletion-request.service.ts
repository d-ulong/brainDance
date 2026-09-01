import { and, eq, isNull, sql } from "drizzle-orm";

import type { Database } from "@/db";
import { deletionExecutionSteps, deletionRequests, deletionTombstones } from "@/db/schema";
import { appendAuditEvent } from "@/modules/audit/append-audit-event";
import {
  DELETION_REVOCABLE_DAYS,
  DELETION_STATUS,
  DELETION_STEP,
  DELETION_TARGET_TYPE,
} from "@/modules/data-lifecycle/constants";
import { DataLifecycleError } from "@/modules/data-lifecycle/errors";
import {
  incrementStudentAuthorizationEpoch,
  purgeExportArtifactKeys,
  revokeReadyExportJobsForStudentInTx,
  revokeStudentSessions,
} from "@/modules/data-lifecycle/freeze-guard.service";
import type { PrivateArtifactStore } from "@/modules/data-lifecycle/private-artifact-store";
import { revokeAllRelationshipsForStudentDeletion } from "@/modules/family-access/account-deletion.service";
import {
  minimizeStudentIdentityForDeletion,
  purgeStudentSessionsInTx,
} from "@/modules/identity/account-deletion.service";
import { appendOutboxEvent } from "@/modules/outbox/append-outbox-event";
import { resetProjectionsAfterStudentDeletion } from "@/modules/projection/account-deletion.service";
import {
  purgeAllReflectionBodiesForStudent,
  purgeReflectionBodyById,
  revokeAllPrivateGrantsForStudent,
  revokePrivateGrantsForReflection,
} from "@/modules/reflection-privacy/account-deletion.service";
import { cancelPendingScheduleItemsForStudent } from "@/modules/schedule/account-deletion.service";
import { hashIdempotencyPayload } from "@/modules/schedule/normalize-idempotency-payload";
import { purgeTrainingPayloadsForStudent } from "@/modules/training/account-deletion.service";
import { dailyReflections, users } from "@/db/schema";
import { isPostgresUniqueViolation } from "@/lib/postgres-errors";

export { applyTombstonesBeforeProjectionRebuild } from "@/modules/data-lifecycle/tombstone-replay.service";

export type DeletionRequestActor = {
  actorId: string;
  actorRole: "student" | "parent" | "admin";
};

export type CreateDeletionRequestInput = {
  targetType: (typeof DELETION_TARGET_TYPE)[keyof typeof DELETION_TARGET_TYPE];
  targetId: string;
  requestedBy: string;
  requesterRole: "student" | "parent" | "admin";
  idempotencyKey: string;
  requestId?: string;
  artifactStore?: PrivateArtifactStore;
};

export type CreateDeletionRequestResult = {
  requestId: string;
  status: string;
  revocableUntil: Date;
  idempotentReplay: boolean;
};

export type DeletionRequestDto = {
  id: string;
  targetType: string;
  targetId: string;
  studentId: string;
  requestedBy: string;
  status: string;
  revocableUntil: Date;
  studentConfirmedAt: Date | null;
  requestedAt: Date;
  executedAt: Date | null;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function assertDeletionRequestActorCanAccess(
  request: DeletionRequestDto,
  actor: DeletionRequestActor,
): void {
  if (actor.actorRole === "admin") {
    return;
  }

  if (request.requestedBy !== actor.actorId && request.studentId !== actor.actorId) {
    throw new DataLifecycleError("NOT_FOUND", "Deletion request not found");
  }
}

function toDeletionDto(row: typeof deletionRequests.$inferSelect): DeletionRequestDto {
  return {
    id: row.id,
    targetType: row.targetType,
    targetId: row.targetId,
    studentId: row.studentId,
    requestedBy: row.requestedBy,
    status: row.status,
    revocableUntil: row.revocableUntil,
    studentConfirmedAt: row.studentConfirmedAt,
    requestedAt: row.requestedAt,
    executedAt: row.executedAt,
  };
}

async function resolveStudentIdForTarget(
  db: Database,
  targetType: string,
  targetId: string,
): Promise<string> {
  if (targetType === DELETION_TARGET_TYPE.STUDENT_ACCOUNT) {
    const [user] = await db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.id, targetId))
      .limit(1);

    if (!user || user.role !== "student") {
      throw new DataLifecycleError("NOT_FOUND", "Student account not found");
    }

    return user.id;
  }

  const [reflection] = await db
    .select({ studentId: dailyReflections.studentId })
    .from(dailyReflections)
    .where(and(eq(dailyReflections.id, targetId), isNull(dailyReflections.deletedAt)))
    .limit(1);

  if (!reflection) {
    throw new DataLifecycleError("NOT_FOUND", "Daily reflection not found");
  }

  return reflection.studentId;
}

export async function createDeletionRequest(
  db: Database,
  input: CreateDeletionRequestInput,
): Promise<CreateDeletionRequestResult> {
  const studentId = await resolveStudentIdForTarget(db, input.targetType, input.targetId);

  if (input.targetType === DELETION_TARGET_TYPE.STUDENT_ACCOUNT) {
    if (input.requesterRole !== "student" && input.requesterRole !== "admin") {
      throw new DataLifecycleError(
        "FORBIDDEN",
        "Only the student or admin may request account deletion",
      );
    }
    if (input.requesterRole === "student" && input.requestedBy !== studentId) {
      throw new DataLifecycleError(
        "FORBIDDEN",
        "Student account deletion must be requested by the student",
      );
    }
  } else if (input.requesterRole === "student" && input.requestedBy !== studentId) {
    throw new DataLifecycleError(
      "FORBIDDEN",
      "Reflection deletion must be requested by the owning student",
    );
  }

  const payloadHash = hashIdempotencyPayload({
    targetType: input.targetType,
    targetId: input.targetId,
  });

  const result = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`deletion.create:${input.requestedBy}:${input.idempotencyKey}`}))`,
    );

    const [existingInTx] = await tx
      .select()
      .from(deletionRequests)
      .where(
        and(
          eq(deletionRequests.requestedBy, input.requestedBy),
          eq(deletionRequests.createIdempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);

    if (existingInTx) {
      if (existingInTx.createIdempotencyPayloadHash !== payloadHash) {
        throw new DataLifecycleError(
          "IDEMPOTENCY_CONFLICT",
          "Deletion request idempotency conflict",
        );
      }
      return {
        requestId: existingInTx.id,
        status: existingInTx.status,
        revocableUntil: existingInTx.revocableUntil,
        idempotentReplay: true,
        artifactKeys: [] as string[],
      };
    }

    const now = new Date();
    const revocableUntil = new Date(now.getTime() + DELETION_REVOCABLE_DAYS * MS_PER_DAY);

    let inserted: Array<{ id: string }> = [];

    try {
      inserted = await tx
        .insert(deletionRequests)
        .values({
          targetType: input.targetType,
          targetId: input.targetId,
          studentId,
          requestedBy: input.requestedBy,
          status: DELETION_STATUS.FROZEN,
          revocableUntil,
          createIdempotencyKey: input.idempotencyKey,
          createIdempotencyPayloadHash: payloadHash,
          requestedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({
          target: [deletionRequests.requestedBy, deletionRequests.createIdempotencyKey],
        })
        .returning({ id: deletionRequests.id });
    } catch (error) {
      if (!isPostgresUniqueViolation(error)) {
        throw error;
      }
    }

    const request = inserted[0];

    if (request) {
      let artifactKeys: string[] = [];

      if (input.targetType === DELETION_TARGET_TYPE.STUDENT_ACCOUNT) {
        await revokeStudentSessions(tx, studentId);
        await incrementStudentAuthorizationEpoch(tx, studentId);
        const revoked = await revokeReadyExportJobsForStudentInTx(tx, studentId);
        artifactKeys = revoked.artifactKeys;
      }

      await appendAuditEvent(tx, {
        actorId: input.requestedBy,
        action: "deletion.request",
        resourceType: "deletion_request",
        resourceId: request.id,
        requestId: input.requestId,
        idempotencyKey: `audit:deletion.create:${input.requestedBy}:${input.idempotencyKey}`,
        metadata: {
          targetType: input.targetType,
          studentId,
        },
      });

      await appendOutboxEvent(tx, {
        aggregateType: "deletion_request",
        aggregateId: request.id,
        eventType: "deletion.frozen",
        dedupeKey: `outbox:deletion.create:${input.requestedBy}:${input.idempotencyKey}`,
        payload: {
          requestId: request.id,
          targetType: input.targetType,
          targetId: input.targetId,
          studentId,
        },
      });

      return {
        requestId: request.id,
        status: DELETION_STATUS.FROZEN,
        revocableUntil,
        idempotentReplay: false,
        artifactKeys,
      };
    }

    const [replay] = await tx
      .select()
      .from(deletionRequests)
      .where(
        and(
          eq(deletionRequests.requestedBy, input.requestedBy),
          eq(deletionRequests.createIdempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);

    if (!replay) {
      throw new DataLifecycleError("STATE_CONFLICT", "Failed to create deletion request");
    }

    if (replay.createIdempotencyPayloadHash !== payloadHash) {
      throw new DataLifecycleError("IDEMPOTENCY_CONFLICT", "Deletion request idempotency conflict");
    }

    return {
      requestId: replay.id,
      status: replay.status,
      revocableUntil: replay.revocableUntil,
      idempotentReplay: true,
      artifactKeys: [] as string[],
    };
  });

  await purgeExportArtifactKeys(input.artifactStore, result.artifactKeys);

  return {
    requestId: result.requestId,
    status: result.status,
    revocableUntil: result.revocableUntil,
    idempotentReplay: result.idempotentReplay,
  };
}

export type CancelDeletionRequestInput = {
  requestId: string;
  actorId: string;
  idempotencyKey: string;
  requestIdHeader?: string;
};

export async function cancelDeletionRequest(
  db: Database,
  input: CancelDeletionRequestInput,
): Promise<{ requestId: string; status: string; idempotentReplay: boolean }> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT id FROM deletion_requests WHERE id = ${input.requestId}::uuid FOR UPDATE`,
    );

    const [request] = await tx
      .select()
      .from(deletionRequests)
      .where(eq(deletionRequests.id, input.requestId))
      .limit(1);

    if (!request) {
      throw new DataLifecycleError("NOT_FOUND", "Deletion request not found");
    }

    if (request.requestedBy !== input.actorId && request.studentId !== input.actorId) {
      throw new DataLifecycleError("FORBIDDEN", "Not authorized to cancel deletion request");
    }

    if (request.status === DELETION_STATUS.CANCELLED) {
      return { requestId: request.id, status: request.status, idempotentReplay: true };
    }

    if (request.status !== DELETION_STATUS.FROZEN) {
      throw new DataLifecycleError("STATE_CONFLICT", "Deletion request is not cancellable");
    }

    if (request.revocableUntil.getTime() < Date.now()) {
      throw new DataLifecycleError("REVOCATION_EXPIRED", "Revocation window has expired");
    }

    const now = new Date();

    await tx
      .update(deletionRequests)
      .set({ status: DELETION_STATUS.CANCELLED, cancelledAt: now, updatedAt: now })
      .where(eq(deletionRequests.id, request.id));

    await appendAuditEvent(tx, {
      actorId: input.actorId,
      action: "deletion.cancel",
      resourceType: "deletion_request",
      resourceId: request.id,
      requestId: input.requestIdHeader,
      idempotencyKey: `audit:deletion.cancel:${input.requestId}:${input.idempotencyKey}`,
      metadata: { studentId: request.studentId },
    });

    return { requestId: request.id, status: DELETION_STATUS.CANCELLED, idempotentReplay: false };
  });
}

export type ConfirmDeletionRequestInput = {
  requestId: string;
  studentId: string;
  idempotencyKey: string;
  requestIdHeader?: string;
};

export async function confirmDeletionRequest(
  db: Database,
  input: ConfirmDeletionRequestInput,
): Promise<{ requestId: string; studentConfirmedAt: Date; idempotentReplay: boolean }> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT id FROM deletion_requests WHERE id = ${input.requestId}::uuid FOR UPDATE`,
    );

    const [request] = await tx
      .select()
      .from(deletionRequests)
      .where(eq(deletionRequests.id, input.requestId))
      .limit(1);

    if (!request) {
      throw new DataLifecycleError("NOT_FOUND", "Deletion request not found");
    }

    if (request.studentId !== input.studentId) {
      throw new DataLifecycleError("FORBIDDEN", "Student confirmation required from account owner");
    }

    if (request.studentConfirmedAt) {
      return {
        requestId: request.id,
        studentConfirmedAt: request.studentConfirmedAt,
        idempotentReplay: true,
      };
    }

    if (request.status !== DELETION_STATUS.FROZEN) {
      throw new DataLifecycleError(
        "STATE_CONFLICT",
        "Deletion request is not awaiting confirmation",
      );
    }

    const now = new Date();

    await tx
      .update(deletionRequests)
      .set({ studentConfirmedAt: now, updatedAt: now })
      .where(eq(deletionRequests.id, request.id));

    await appendAuditEvent(tx, {
      actorId: input.studentId,
      action: "deletion.confirm",
      resourceType: "deletion_request",
      resourceId: request.id,
      requestId: input.requestIdHeader,
      idempotencyKey: `audit:deletion.confirm:${input.requestId}:${input.idempotencyKey}`,
      metadata: { studentId: request.studentId },
    });

    await appendOutboxEvent(tx, {
      aggregateType: "deletion_request",
      aggregateId: request.id,
      eventType: "deletion.confirmed",
      dedupeKey: `outbox:deletion.confirm:${input.requestId}:${input.idempotencyKey}`,
      payload: { requestId: request.id, studentId: request.studentId },
    });

    return { requestId: request.id, studentConfirmedAt: now, idempotentReplay: false };
  });
}

export type AdminForceDeletionInput = {
  requestId: string;
  adminId: string;
  reason: string;
  idempotencyKey: string;
  requestIdHeader?: string;
};

export async function adminForceDeletionExecution(
  db: Database,
  input: AdminForceDeletionInput,
): Promise<{ requestId: string; adminForceReason: string; idempotentReplay: boolean }> {
  if (!input.reason.trim()) {
    throw new DataLifecycleError("VALIDATION_ERROR", "Admin force reason is required");
  }

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT id FROM deletion_requests WHERE id = ${input.requestId}::uuid FOR UPDATE`,
    );

    const [request] = await tx
      .select()
      .from(deletionRequests)
      .where(eq(deletionRequests.id, input.requestId))
      .limit(1);

    if (!request) {
      throw new DataLifecycleError("NOT_FOUND", "Deletion request not found");
    }

    if (request.status !== DELETION_STATUS.FROZEN) {
      throw new DataLifecycleError("STATE_CONFLICT", "Deletion request is not forceable");
    }

    const now = new Date();

    await tx
      .update(deletionRequests)
      .set({
        adminForceReason: input.reason.trim(),
        studentConfirmedAt: request.studentConfirmedAt ?? now,
        updatedAt: now,
      })
      .where(eq(deletionRequests.id, request.id));

    await appendAuditEvent(tx, {
      actorId: input.adminId,
      action: "deletion.admin_force",
      resourceType: "deletion_request",
      resourceId: request.id,
      reasonCode: "admin_force_deletion",
      requestId: input.requestIdHeader,
      idempotencyKey: `audit:deletion.admin_force:${input.requestId}:${input.idempotencyKey}`,
      metadata: {
        studentId: request.studentId,
        reasonLength: input.reason.trim().length,
      },
    });

    await appendOutboxEvent(tx, {
      aggregateType: "deletion_request",
      aggregateId: request.id,
      eventType: "deletion.admin_forced",
      dedupeKey: `outbox:deletion.admin_force:${input.requestId}:${input.idempotencyKey}`,
      payload: { requestId: request.id, adminId: input.adminId },
    });

    return {
      requestId: request.id,
      adminForceReason: input.reason.trim(),
      idempotentReplay: false,
    };
  });
}

export async function getDeletionRequest(
  db: Database,
  requestId: string,
): Promise<DeletionRequestDto | null> {
  const [row] = await db
    .select()
    .from(deletionRequests)
    .where(eq(deletionRequests.id, requestId))
    .limit(1);

  return row ? toDeletionDto(row) : null;
}

export async function getDeletionRequestForActor(
  db: Database,
  requestId: string,
  actor: DeletionRequestActor,
): Promise<DeletionRequestDto> {
  const request = await getDeletionRequest(db, requestId);
  if (!request) {
    throw new DataLifecycleError("NOT_FOUND", "Deletion request not found");
  }

  assertDeletionRequestActorCanAccess(request, actor);
  return request;
}

async function isStepCompleted(
  tx: Database,
  deletionRequestId: string,
  stepVersion: number,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: deletionExecutionSteps.id })
    .from(deletionExecutionSteps)
    .where(
      and(
        eq(deletionExecutionSteps.deletionRequestId, deletionRequestId),
        eq(deletionExecutionSteps.stepVersion, stepVersion),
      ),
    )
    .limit(1);

  return Boolean(row);
}

async function markStepCompleted(
  tx: Database,
  deletionRequestId: string,
  stepVersion: number,
  now: Date,
): Promise<boolean> {
  const inserted = await tx
    .insert(deletionExecutionSteps)
    .values({
      deletionRequestId,
      stepVersion,
      completedAt: now,
      createdAt: now,
    })
    .onConflictDoNothing({
      target: [deletionExecutionSteps.deletionRequestId, deletionExecutionSteps.stepVersion],
    })
    .returning({ id: deletionExecutionSteps.id });

  return inserted.length > 0;
}

export type ProcessDeletionWorkerInput = {
  requestId: string;
  artifactStore?: PrivateArtifactStore;
  now?: Date;
};

export async function processDeletionWorker(
  db: Database,
  input: ProcessDeletionWorkerInput,
): Promise<{ requestId: string; status: string; executed: boolean }> {
  const now = input.now ?? new Date();
  const artifactKeysToPurge: string[] = [];

  const result = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT id FROM deletion_requests WHERE id = ${input.requestId}::uuid FOR UPDATE`,
    );

    const [request] = await tx
      .select()
      .from(deletionRequests)
      .where(eq(deletionRequests.id, input.requestId))
      .limit(1);

    if (!request) {
      throw new DataLifecycleError("NOT_FOUND", "Deletion request not found");
    }

    if (request.status === DELETION_STATUS.EXECUTED) {
      return { requestId: request.id, status: request.status, executed: false };
    }

    if (request.status !== DELETION_STATUS.FROZEN) {
      throw new DataLifecycleError("STATE_CONFLICT", "Deletion request is not executable");
    }

    if (!request.studentConfirmedAt && !request.adminForceReason) {
      throw new DataLifecycleError(
        "CONFIRMATION_REQUIRED",
        "Student confirmation or admin force required",
      );
    }

    const studentId = request.studentId;

    if (!(await isStepCompleted(tx, request.id, DELETION_STEP.REVOKE_SESSIONS_ARTIFACTS))) {
      await revokeStudentSessions(tx, studentId);
      const revoked = await revokeReadyExportJobsForStudentInTx(tx, studentId);
      artifactKeysToPurge.push(...revoked.artifactKeys);
      await markStepCompleted(tx, request.id, DELETION_STEP.REVOKE_SESSIONS_ARTIFACTS, now);
    }

    if (!(await isStepCompleted(tx, request.id, DELETION_STEP.STOP_FUTURE_SCHEDULE))) {
      if (request.targetType === DELETION_TARGET_TYPE.STUDENT_ACCOUNT) {
        await cancelPendingScheduleItemsForStudent(tx, studentId);
        await revokeAllRelationshipsForStudentDeletion(tx, { studentId, now });
        await revokeAllPrivateGrantsForStudent(tx, { studentId, now });
      }
      await markStepCompleted(tx, request.id, DELETION_STEP.STOP_FUTURE_SCHEDULE, now);
    }

    if (!(await isStepCompleted(tx, request.id, DELETION_STEP.PURGE_BODIES))) {
      if (request.targetType === DELETION_TARGET_TYPE.STUDENT_ACCOUNT) {
        await purgeAllReflectionBodiesForStudent(tx, { studentId, now });
        await purgeTrainingPayloadsForStudent(tx, studentId);
      } else {
        await purgeReflectionBodyById(tx, { reflectionId: request.targetId, now });
        await revokePrivateGrantsForReflection(tx, { reflectionId: request.targetId, now });
      }
      await markStepCompleted(tx, request.id, DELETION_STEP.PURGE_BODIES, now);
    }

    if (!(await isStepCompleted(tx, request.id, DELETION_STEP.MINIMIZE_IDENTITY))) {
      if (request.targetType === DELETION_TARGET_TYPE.STUDENT_ACCOUNT) {
        await minimizeStudentIdentityForDeletion(tx, {
          studentId,
          deletionRequestId: request.id,
          now,
        });
        await purgeStudentSessionsInTx(tx, studentId);
      }
      await markStepCompleted(tx, request.id, DELETION_STEP.MINIMIZE_IDENTITY, now);
    }

    if (!(await isStepCompleted(tx, request.id, DELETION_STEP.CLEANUP_PROJECTIONS))) {
      if (request.targetType === DELETION_TARGET_TYPE.STUDENT_ACCOUNT) {
        await resetProjectionsAfterStudentDeletion(tx, { studentId, now });
      }
      await markStepCompleted(tx, request.id, DELETION_STEP.CLEANUP_PROJECTIONS, now);
    }

    if (!(await isStepCompleted(tx, request.id, DELETION_STEP.WRITE_TOMBSTONE))) {
      await tx
        .insert(deletionTombstones)
        .values({
          deletionRequestId: request.id,
          targetType: request.targetType,
          targetId: request.targetId,
          studentId,
          tombstoneVersion: 1,
          purgedAt: now,
          payload: { requestId: request.id },
          createdAt: now,
        })
        .onConflictDoNothing({
          target: [deletionTombstones.targetType, deletionTombstones.targetId],
        });
      await markStepCompleted(tx, request.id, DELETION_STEP.WRITE_TOMBSTONE, now);
    }

    if (!(await isStepCompleted(tx, request.id, DELETION_STEP.MARK_EXECUTED))) {
      await tx
        .update(deletionRequests)
        .set({ status: DELETION_STATUS.EXECUTED, executedAt: now, updatedAt: now })
        .where(eq(deletionRequests.id, request.id));

      await appendAuditEvent(tx, {
        actorId: null,
        action: "deletion.executed",
        resourceType: "deletion_request",
        resourceId: request.id,
        idempotencyKey: `audit:deletion.executed:${request.id}`,
        metadata: { studentId, targetType: request.targetType },
      });

      await markStepCompleted(tx, request.id, DELETION_STEP.MARK_EXECUTED, now);
    }

    return { requestId: request.id, status: DELETION_STATUS.EXECUTED, executed: true };
  });

  await purgeExportArtifactKeys(input.artifactStore, artifactKeysToPurge);

  return result;
}

export async function findTombstoneForTarget(
  db: Database,
  targetType: string,
  targetId: string,
): Promise<typeof deletionTombstones.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(deletionTombstones)
    .where(
      and(eq(deletionTombstones.targetType, targetType), eq(deletionTombstones.targetId, targetId)),
    )
    .limit(1);

  return row ?? null;
}
