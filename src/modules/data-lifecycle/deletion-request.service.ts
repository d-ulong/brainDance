import { and, eq, isNull, sql } from "drizzle-orm";

import type { Database } from "@/db";
import {
  auditEvents,
  dailyReflections,
  deletionExecutionSteps,
  deletionRequests,
  deletionTombstones,
  privateAccessGrants,
  sessions,
  trainingProfileProjection,
  users,
} from "@/db/schema";
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
  revokeReadyExportJobsForStudent,
  revokeStudentSessions,
} from "@/modules/data-lifecycle/freeze-guard.service";
import type { PrivateArtifactStore } from "@/modules/data-lifecycle/private-artifact-store";
import { appendOutboxEvent } from "@/modules/outbox/append-outbox-event";
import { rebuildProjectionForStudent } from "@/modules/projection/rebuild-projection.service";
import { hashIdempotencyPayload } from "@/modules/schedule/normalize-idempotency-payload";
import { PRIVATE_RESOURCE_TYPES } from "@/modules/reflection-privacy/constants";
import { rebuildTrainingProfileProjectionForStudent } from "@/modules/training/trends.service";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

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

async function findDeletionCreateReplay(
  db: Database,
  requestedBy: string,
  idempotencyKey: string,
): Promise<string | null> {
  const auditKey = `audit:deletion.create:${requestedBy}:${idempotencyKey}`;
  const [existing] = await db
    .select({ resourceId: auditEvents.resourceId })
    .from(auditEvents)
    .where(eq(auditEvents.idempotencyKey, auditKey))
    .limit(1);

  return existing?.resourceId ?? null;
}

export async function createDeletionRequest(
  db: Database,
  input: CreateDeletionRequestInput,
): Promise<CreateDeletionRequestResult> {
  const replayId = await findDeletionCreateReplay(db, input.requestedBy, input.idempotencyKey);
  if (replayId) {
    const [existing] = await db
      .select()
      .from(deletionRequests)
      .where(eq(deletionRequests.id, replayId))
      .limit(1);
    if (existing) {
      return {
        requestId: existing.id,
        status: existing.status,
        revocableUntil: existing.revocableUntil,
        idempotentReplay: true,
      };
    }
  }

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

  return db.transaction(async (tx) => {
    const replayInTx = await findDeletionCreateReplay(tx, input.requestedBy, input.idempotencyKey);
    if (replayInTx) {
      const [existing] = await tx
        .select()
        .from(deletionRequests)
        .where(eq(deletionRequests.id, replayInTx))
        .limit(1);
      if (existing) {
        return {
          requestId: existing.id,
          status: existing.status,
          revocableUntil: existing.revocableUntil,
          idempotentReplay: true,
        };
      }
    }

    const now = new Date();
    const revocableUntil = new Date(now.getTime() + DELETION_REVOCABLE_DAYS * MS_PER_DAY);

    const [request] = await tx
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
      .returning({ id: deletionRequests.id });

    if (!request) {
      throw new DataLifecycleError("STATE_CONFLICT", "Failed to create deletion request");
    }

    if (input.targetType === DELETION_TARGET_TYPE.STUDENT_ACCOUNT) {
      await revokeStudentSessions(tx, studentId);
      await incrementStudentAuthorizationEpoch(tx, studentId);
      await revokeReadyExportJobsForStudent(tx, studentId, input.artifactStore);
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
    };
  });
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

    // Step 1: revoke sessions/artifacts
    if (!(await isStepCompleted(tx, request.id, DELETION_STEP.REVOKE_SESSIONS_ARTIFACTS))) {
      await revokeStudentSessions(tx, studentId);
      await revokeReadyExportJobsForStudent(tx, studentId, input.artifactStore);
      await markStepCompleted(tx, request.id, DELETION_STEP.REVOKE_SESSIONS_ARTIFACTS, now);
    }

    // Step 2: stop future schedule (deactivate pending schedule items for student account deletion)
    if (
      request.targetType === DELETION_TARGET_TYPE.STUDENT_ACCOUNT &&
      !(await isStepCompleted(tx, request.id, DELETION_STEP.STOP_FUTURE_SCHEDULE))
    ) {
      await tx.execute(sql`
        UPDATE schedule_items
        SET status = 'cancelled'
        WHERE student_id = ${studentId}::uuid AND status = 'pending'
      `);
      await markStepCompleted(tx, request.id, DELETION_STEP.STOP_FUTURE_SCHEDULE, now);
    } else if (
      request.targetType === DELETION_TARGET_TYPE.DAILY_REFLECTION &&
      !(await isStepCompleted(tx, request.id, DELETION_STEP.STOP_FUTURE_SCHEDULE))
    ) {
      await markStepCompleted(tx, request.id, DELETION_STEP.STOP_FUTURE_SCHEDULE, now);
    }

    // Step 3: purge bodies
    if (!(await isStepCompleted(tx, request.id, DELETION_STEP.PURGE_BODIES))) {
      if (request.targetType === DELETION_TARGET_TYPE.STUDENT_ACCOUNT) {
        await tx
          .update(dailyReflections)
          .set({ body: "", deletedAt: now, bodyPurgedAt: now, updatedAt: now })
          .where(eq(dailyReflections.studentId, studentId));

        await tx.execute(sql`
          UPDATE training_events
          SET payload = '{}'::jsonb
          FROM training_sessions
          WHERE training_events.session_id = training_sessions.id
            AND training_sessions.student_id = ${studentId}::uuid
        `);
      } else {
        await tx
          .update(dailyReflections)
          .set({ body: "", deletedAt: now, bodyPurgedAt: now, updatedAt: now })
          .where(eq(dailyReflections.id, request.targetId));

        await tx
          .update(privateAccessGrants)
          .set({ revokedAt: now })
          .where(
            and(
              eq(privateAccessGrants.resourceId, request.targetId),
              eq(privateAccessGrants.resourceType, PRIVATE_RESOURCE_TYPES.DAILY_REFLECTION),
              isNull(privateAccessGrants.revokedAt),
            ),
          );
      }
      await markStepCompleted(tx, request.id, DELETION_STEP.PURGE_BODIES, now);
    }

    // Step 4: minimize identity (student account only)
    if (
      request.targetType === DELETION_TARGET_TYPE.STUDENT_ACCOUNT &&
      !(await isStepCompleted(tx, request.id, DELETION_STEP.MINIMIZE_IDENTITY))
    ) {
      await tx
        .update(users)
        .set({
          displayName: "Deleted User",
          email: null,
          phone: null,
          username: sql`'deleted_' || ${request.id}::text`,
          status: "disabled",
          updatedAt: now,
        })
        .where(eq(users.id, studentId));

      await tx.delete(sessions).where(eq(sessions.userId, studentId));
      await markStepCompleted(tx, request.id, DELETION_STEP.MINIMIZE_IDENTITY, now);
    } else if (!(await isStepCompleted(tx, request.id, DELETION_STEP.MINIMIZE_IDENTITY))) {
      await markStepCompleted(tx, request.id, DELETION_STEP.MINIMIZE_IDENTITY, now);
    }

    // Step 5: cleanup projections
    if (!(await isStepCompleted(tx, request.id, DELETION_STEP.CLEANUP_PROJECTIONS))) {
      if (request.targetType === DELETION_TARGET_TYPE.STUDENT_ACCOUNT) {
        await tx
          .delete(trainingProfileProjection)
          .where(eq(trainingProfileProjection.studentId, studentId));
        await rebuildProjectionForStudent(tx, studentId, now);
        await rebuildTrainingProfileProjectionForStudent(tx, studentId);
      }
      await markStepCompleted(tx, request.id, DELETION_STEP.CLEANUP_PROJECTIONS, now);
    }

    // Step 6: write tombstone
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

    // Step 7: mark executed
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
}

export async function applyTombstonesBeforeProjectionRebuild(db: Database): Promise<number> {
  const tombstones = await db.select().from(deletionTombstones);
  let applied = 0;

  for (const tombstone of tombstones) {
    if (tombstone.targetType === DELETION_TARGET_TYPE.STUDENT_ACCOUNT) {
      const [user] = await db
        .select({ displayName: users.displayName })
        .from(users)
        .where(eq(users.id, tombstone.targetId))
        .limit(1);

      if (user && user.displayName !== "Deleted User") {
        await db
          .update(users)
          .set({
            displayName: "Deleted User",
            email: null,
            phone: null,
            status: "disabled",
            updatedAt: new Date(),
          })
          .where(eq(users.id, tombstone.targetId));
        applied += 1;
      }

      const reflections = await db
        .select({
          id: dailyReflections.id,
          body: dailyReflections.body,
          deletedAt: dailyReflections.deletedAt,
        })
        .from(dailyReflections)
        .where(eq(dailyReflections.studentId, tombstone.studentId));

      for (const reflection of reflections) {
        if (!reflection.deletedAt || reflection.body.length > 0) {
          await db
            .update(dailyReflections)
            .set({
              body: "",
              deletedAt: tombstone.purgedAt,
              bodyPurgedAt: tombstone.purgedAt,
              updatedAt: new Date(),
            })
            .where(eq(dailyReflections.id, reflection.id));
          applied += 1;
        }
      }
    }

    if (tombstone.targetType === DELETION_TARGET_TYPE.DAILY_REFLECTION) {
      const [reflection] = await db
        .select({ body: dailyReflections.body, deletedAt: dailyReflections.deletedAt })
        .from(dailyReflections)
        .where(eq(dailyReflections.id, tombstone.targetId))
        .limit(1);

      if (reflection && (!reflection.deletedAt || reflection.body.length > 0)) {
        await db
          .update(dailyReflections)
          .set({ body: "", deletedAt: tombstone.purgedAt, bodyPurgedAt: tombstone.purgedAt })
          .where(eq(dailyReflections.id, tombstone.targetId));
        applied += 1;
      }
    }
  }

  return applied;
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
