import { and, asc, eq, sql } from "drizzle-orm";

import type { Database } from "@/db";
import {
  trainingEvents,
  trainingMetrics,
  trainingProfileProjection,
  trainingSessions,
} from "@/db/schema";
import { appendAuditEvent } from "@/modules/audit/append-audit-event";
import { appendOutboxEvent } from "@/modules/outbox/append-outbox-event";
import { requireActiveRelationship } from "@/modules/family-access/authorization.service";
import {
  getActiveTrainingDefinition,
  getSessionTrainingDefinition,
} from "@/modules/training/definition.service";
import { REACTION_TRAINING_KEY, TRAINING_BLUR_ABANDON_MS } from "@/modules/training/constants";
import {
  buildFullRebuildProjectionLockKey,
  buildSubmitCompetitionLockKey,
} from "@/modules/training/submit-competition-lock-key";
import { TrainingError } from "@/modules/training/errors";
import { assertStudentAccountNotFrozen } from "@/modules/data-lifecycle/freeze-guard.service";
import {
  buildProjectionStateFromRows,
  filterProjectionEligibleMetrics,
  getProjectionMetricDefinitions,
  mergeMetricIntoProjectionState,
  type ProjectionMetricInput,
} from "@/modules/training/profile-projection-reducer";
import {
  computeTrainingMetrics,
  decodeMetricSchema,
  getExpectedSessionCount,
  getTrainingProtocol,
  metricRowsToDbValues,
  validateTrainingEvents,
} from "@/modules/training/protocol";
import {
  compatStudentIdForSubject,
  resolveTrainingSubject,
  type TrainingAgeBand,
  type TrainingSubject,
} from "@/modules/training/training-subject";
import { toFamilyDate } from "@/modules/time-policy/to-family-date";
import { isPostgresUniqueViolation } from "@/lib/postgres-errors";
import {
  queryTrainingTrends,
  type TrainingTrendsResponse,
} from "@/modules/training/trends.service";
import type { TrendWindow } from "@/modules/training/trend-window";

export type StartTrainingSessionInput = {
  subject: TrainingSubject;
  trainingKey: string;
  idempotencyKey: string;
  requestId?: string;
};

export type StartTrainingSessionResult = {
  sessionId: string;
  trainingKey: string;
  definitionVersion: number;
  ageBand: TrainingAgeBand;
  familyDate: string;
  expectedTrialCount: number;
  status: "active";
  idempotentReplay: boolean;
};

export type AppendTrainingEventInput = {
  subject: TrainingSubject;
  sessionId: string;
  sequence: number;
  eventType: string;
  payload: Record<string, unknown>;
};

export type AppendTrainingEventResult = {
  sequence: number;
  occurredAt: Date;
  blurAccumulatedMs: number;
  abandoned: boolean;
};

export type SubmitTrainingSessionInput = {
  subject: TrainingSubject;
  sessionId: string;
  idempotencyKey: string;
  requestId?: string;
};

export type TrainingMetricDto = {
  metricKey: string;
  value: number;
  unit: string;
  isValid: boolean;
  calculationVersion: string;
};

export type SubmitTrainingSessionResult = {
  sessionId: string;
  status: "completed" | "invalid" | "abandoned";
  sessionKind: "effective" | "practice" | null;
  metrics: TrainingMetricDto[];
  idempotentReplay: boolean;
};

export type TrainingSessionDetail = {
  sessionId: string;
  trainingKey: string;
  definitionVersion: number;
  ageBand: string;
  familyDate: string;
  status: string;
  sessionKind: "effective" | "practice" | null;
  startedAt: string;
  finishedAt: string | null;
  blurAccumulatedMs: number;
  invalidReason: string | null;
  metrics: TrainingMetricDto[];
  eventCount: number;
};

export type ParentTrainingSummary = {
  studentId: string;
  trainingKey: string;
  definitionVersion: number;
  ageBand: string;
  familyDate: string;
  lastSession: {
    sessionId: string;
    status: string;
    sessionKind: "effective" | "practice" | null;
    finishedAt: string | null;
    metrics: TrainingMetricDto[];
  } | null;
  projection: Array<{
    metricKey: string;
    bestValue: number;
    lastValue: number;
  }>;
};

export type SubjectTrainingSummary = {
  traineeId: string;
  trainingKey: string;
  definitionVersion: number;
  ageBand: string;
  familyDate: string;
  lastSession: ParentTrainingSummary["lastSession"];
  projection: ParentTrainingSummary["projection"];
};

export type SubjectTrainingTrends = Omit<TrainingTrendsResponse, "studentId"> & {
  traineeId: string;
};

type StudentFacadeInput = {
  studentId: string;
};

/**
 * Service-layer authority: re-resolve from traineeId and reject forged role/ageBand.
 * Callers' traineeRole/ageBand are never trusted.
 */
async function authorizeTrainingSubject(
  db: Database,
  claimed: TrainingSubject,
): Promise<TrainingSubject> {
  const resolved = await resolveTrainingSubject(db, claimed.traineeId);
  if (
    claimed.traineeId !== resolved.traineeId ||
    claimed.traineeRole !== resolved.traineeRole ||
    claimed.ageBand !== resolved.ageBand
  ) {
    throw new TrainingError("FORBIDDEN", "Training subject claim mismatch");
  }
  return resolved;
}

async function assertSubjectWritable(db: Database, subject: TrainingSubject): Promise<void> {
  if (subject.traineeRole === "student") {
    await assertStudentAccountNotFrozen(db, subject.traineeId, "write");
  }
}

async function assertSubjectReadable(db: Database, subject: TrainingSubject): Promise<void> {
  if (subject.traineeRole === "student") {
    await assertStudentAccountNotFrozen(db, subject.traineeId, "read");
  }
}

async function loadOwnedSession(db: Database, traineeId: string, sessionId: string) {
  const [session] = await db
    .select()
    .from(trainingSessions)
    .where(and(eq(trainingSessions.id, sessionId), eq(trainingSessions.traineeId, traineeId)))
    .limit(1);

  if (!session) {
    throw new TrainingError("SESSION_NOT_FOUND", "Training session not found");
  }

  return session;
}

async function loadSessionEvents(db: Database, sessionId: string) {
  return db
    .select({
      sequence: trainingEvents.sequence,
      eventType: trainingEvents.eventType,
      payload: trainingEvents.payload,
      occurredAt: trainingEvents.occurredAt,
    })
    .from(trainingEvents)
    .where(eq(trainingEvents.sessionId, sessionId))
    .orderBy(asc(trainingEvents.sequence));
}

async function loadSessionMetrics(db: Database, sessionId: string): Promise<TrainingMetricDto[]> {
  const rows = await db
    .select()
    .from(trainingMetrics)
    .where(eq(trainingMetrics.sessionId, sessionId));

  return rows.map((row) => ({
    metricKey: row.metricKey,
    value: Number(row.value),
    unit: row.unit,
    isValid: row.isValid === 1,
    calculationVersion: row.calculationVersion,
  }));
}

function resolveDecodedSchema(trainingKey: string, metricSchema: Record<string, unknown>) {
  const decoded = decodeMetricSchema(trainingKey, metricSchema);
  if (!decoded) {
    throw new TrainingError("TRAINING_DEFINITION_NOT_FOUND", "Invalid training definition schema");
  }
  return decoded;
}

async function upsertProfileProjection(
  tx: Database,
  input: {
    subject: TrainingSubject;
    trainingKey: string;
    definitionVersion: number;
    ageBand: string;
    sessionId: string;
    familyDate: string;
    metrics: TrainingMetricDto[];
  },
) {
  const existingRows = await tx
    .select()
    .from(trainingProfileProjection)
    .where(
      and(
        eq(trainingProfileProjection.traineeId, input.subject.traineeId),
        eq(trainingProfileProjection.trainingKey, input.trainingKey),
        eq(trainingProfileProjection.definitionVersion, input.definitionVersion),
        eq(trainingProfileProjection.ageBand, input.ageBand),
      ),
    );

  const state = buildProjectionStateFromRows(existingRows, input.familyDate);
  const sessionMetrics: ProjectionMetricInput[] = input.metrics.map((metric) => ({
    metricKey: metric.metricKey,
    value: metric.value,
    isValid: metric.isValid,
  }));

  mergeMetricIntoProjectionState(state, {
    trainingKey: input.trainingKey,
    sessionId: input.sessionId,
    familyDate: input.familyDate,
    metrics: sessionMetrics,
  });

  const compatStudentId = compatStudentIdForSubject(input.subject);

  for (const metric of filterProjectionEligibleMetrics(input.trainingKey, sessionMetrics)) {
    const row = state.get(metric.metricKey);
    if (!row) {
      continue;
    }

    await tx
      .insert(trainingProfileProjection)
      .values({
        traineeId: input.subject.traineeId,
        studentId: compatStudentId,
        trainingKey: input.trainingKey,
        definitionVersion: input.definitionVersion,
        ageBand: input.ageBand,
        metricKey: row.metricKey,
        bestValue: row.bestValue.toFixed(6),
        lastValue: row.lastValue.toFixed(6),
        lastSourceSessionId: row.lastSourceSessionId,
        windowSummary: { lastFamilyDate: row.lastFamilyDate },
      })
      .onConflictDoUpdate({
        target: [
          trainingProfileProjection.traineeId,
          trainingProfileProjection.trainingKey,
          trainingProfileProjection.definitionVersion,
          trainingProfileProjection.ageBand,
          trainingProfileProjection.metricKey,
        ],
        set: {
          bestValue: row.bestValue.toFixed(6),
          lastValue: row.lastValue.toFixed(6),
          lastSourceSessionId: row.lastSourceSessionId,
          windowSummary: { lastFamilyDate: row.lastFamilyDate },
          updatedAt: new Date(),
        },
      });
  }
}

async function findStartSessionByIdempotency(
  db: Database,
  traineeId: string,
  idempotencyKey: string,
) {
  const [existing] = await db
    .select()
    .from(trainingSessions)
    .where(
      and(
        eq(trainingSessions.traineeId, traineeId),
        eq(trainingSessions.startIdempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);

  return existing;
}

async function buildStartReplayResult(
  db: Database,
  existing: typeof trainingSessions.$inferSelect,
): Promise<StartTrainingSessionResult> {
  const definition = await getSessionTrainingDefinition(db, existing);
  const schema = resolveDecodedSchema(existing.trainingKey, definition.metricSchema ?? {});

  return {
    sessionId: existing.id,
    trainingKey: existing.trainingKey,
    definitionVersion: existing.definitionVersion,
    ageBand: existing.ageBand as TrainingAgeBand,
    familyDate: existing.familyDate,
    expectedTrialCount: getExpectedSessionCount(existing.trainingKey, schema),
    status: "active",
    idempotentReplay: true,
  };
}

async function resolveSubmitIdempotencyReplay(
  db: Database,
  input: SubmitTrainingSessionInput,
  existing: typeof trainingSessions.$inferSelect,
): Promise<SubmitTrainingSessionResult> {
  if (existing.id !== input.sessionId) {
    throw new TrainingError(
      "IDEMPOTENCY_SESSION_MISMATCH",
      "Submit idempotency key is bound to a different training session",
    );
  }

  const metrics = await loadSessionMetrics(db, existing.id);
  return {
    sessionId: existing.id,
    status: existing.status as SubmitTrainingSessionResult["status"],
    sessionKind: existing.sessionKind,
    metrics,
    idempotentReplay: true,
  };
}

async function findSubmitSessionByIdempotency(
  db: Database,
  traineeId: string,
  idempotencyKey: string,
) {
  const [existing] = await db
    .select()
    .from(trainingSessions)
    .where(
      and(
        eq(trainingSessions.traineeId, traineeId),
        eq(trainingSessions.submitIdempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);

  return existing;
}

export async function startTrainingSessionForSubject(
  db: Database,
  input: StartTrainingSessionInput,
): Promise<StartTrainingSessionResult> {
  const subject = await authorizeTrainingSubject(db, input.subject);
  await assertSubjectWritable(db, subject);

  const existing = await findStartSessionByIdempotency(db, subject.traineeId, input.idempotencyKey);

  if (existing) {
    return buildStartReplayResult(db, existing);
  }

  const ageBand = subject.ageBand;
  if (!getTrainingProtocol(input.trainingKey)) {
    throw new TrainingError(
      "TRAINING_DEFINITION_NOT_FOUND",
      `No active definition for ${input.trainingKey} / ${ageBand}`,
    );
  }
  const definition = await getActiveTrainingDefinition(db, input.trainingKey, ageBand);
  const schema = resolveDecodedSchema(input.trainingKey, definition.metricSchema ?? {});
  const familyDate = toFamilyDate();
  const startedAt = new Date();
  const compatStudentId = compatStudentIdForSubject(subject);

  try {
    return await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(trainingSessions)
        .values({
          traineeId: subject.traineeId,
          studentId: compatStudentId,
          trainingKey: input.trainingKey,
          definitionId: definition.id,
          definitionVersion: definition.version,
          ageBand,
          familyDate,
          startedAt,
          status: "active",
          startIdempotencyKey: input.idempotencyKey,
        })
        .returning();

      if (!created) {
        throw new Error("Failed to create training session");
      }

      await appendAuditEvent(tx, {
        actorId: subject.traineeId,
        action: "training_session.started",
        resourceType: "training_session",
        resourceId: created.id,
        requestId: input.requestId,
        idempotencyKey: `audit:training-start:${subject.traineeId}:${input.idempotencyKey}`,
        metadata: {
          trainingKey: input.trainingKey,
          familyDate,
          ageBand,
          traineeRole: subject.traineeRole,
        },
      });

      return {
        sessionId: created.id,
        trainingKey: created.trainingKey,
        definitionVersion: created.definitionVersion,
        ageBand: created.ageBand as TrainingAgeBand,
        familyDate: created.familyDate,
        expectedTrialCount: getExpectedSessionCount(created.trainingKey, schema),
        status: "active" as const,
        idempotentReplay: false,
      };
    });
  } catch (error) {
    if (!isPostgresUniqueViolation(error)) {
      throw error;
    }

    const raced = await findStartSessionByIdempotency(db, subject.traineeId, input.idempotencyKey);
    if (!raced) {
      throw error;
    }

    return buildStartReplayResult(db, raced);
  }
}

/** Student-named facade for existing callers; resolves TrainingSubject from user id. */
export async function startTrainingSession(
  db: Database,
  input: StudentFacadeInput & {
    trainingKey: string;
    idempotencyKey: string;
    requestId?: string;
  },
): Promise<StartTrainingSessionResult> {
  const subject = await resolveTrainingSubject(db, input.studentId);
  return startTrainingSessionForSubject(db, {
    subject,
    trainingKey: input.trainingKey,
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
  });
}

export async function appendTrainingEventForSubject(
  db: Database,
  input: AppendTrainingEventInput,
): Promise<AppendTrainingEventResult> {
  const subject = await authorizeTrainingSubject(db, input.subject);
  const session = await loadOwnedSession(db, subject.traineeId, input.sessionId);

  if (session.status !== "active") {
    throw new TrainingError("SESSION_INVALID_STATE", "Session is not active");
  }

  const existingEvents = await loadSessionEvents(db, input.sessionId);
  const expectedSequence = existingEvents.length;
  if (input.sequence !== expectedSequence) {
    throw new TrainingError(
      "EVENT_SEQUENCE_INVALID",
      `Expected sequence ${expectedSequence}, got ${input.sequence}`,
    );
  }

  if (input.eventType === "session.blur") {
    const durationMs = input.payload.durationMs;
    if (typeof durationMs !== "number" || durationMs < 0) {
      throw new TrainingError("EVENT_PAYLOAD_INVALID", "Blur event requires durationMs");
    }
  }

  const occurredAt = new Date();
  let blurAccumulatedMs = session.blurAccumulatedMs;
  if (input.eventType === "session.blur") {
    blurAccumulatedMs += Number(input.payload.durationMs);
  }

  await db.insert(trainingEvents).values({
    sessionId: input.sessionId,
    sequence: input.sequence,
    eventType: input.eventType,
    payload: input.payload,
    occurredAt,
  });

  let abandoned = false;
  if (blurAccumulatedMs > TRAINING_BLUR_ABANDON_MS) {
    abandoned = true;
    await db
      .update(trainingSessions)
      .set({
        status: "abandoned",
        blurAccumulatedMs,
        finishedAt: occurredAt,
      })
      .where(eq(trainingSessions.id, input.sessionId));
  } else if (blurAccumulatedMs !== session.blurAccumulatedMs) {
    await db
      .update(trainingSessions)
      .set({ blurAccumulatedMs })
      .where(eq(trainingSessions.id, input.sessionId));
  }

  return {
    sequence: input.sequence,
    occurredAt,
    blurAccumulatedMs,
    abandoned,
  };
}

export async function appendTrainingEvent(
  db: Database,
  input: StudentFacadeInput & {
    sessionId: string;
    sequence: number;
    eventType: string;
    payload: Record<string, unknown>;
  },
): Promise<AppendTrainingEventResult> {
  const subject = await resolveTrainingSubject(db, input.studentId);
  return appendTrainingEventForSubject(db, {
    subject,
    sessionId: input.sessionId,
    sequence: input.sequence,
    eventType: input.eventType,
    payload: input.payload,
  });
}

export async function cancelTrainingSessionForSubject(
  db: Database,
  input: { subject: TrainingSubject; sessionId: string; requestId?: string },
): Promise<{ sessionId: string; status: "cancelled" }> {
  const subject = await authorizeTrainingSubject(db, input.subject);
  const session = await loadOwnedSession(db, subject.traineeId, input.sessionId);

  if (session.status !== "active") {
    throw new TrainingError("SESSION_INVALID_STATE", "Only active sessions can be cancelled");
  }

  const finishedAt = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(trainingSessions)
      .set({ status: "cancelled", finishedAt })
      .where(eq(trainingSessions.id, input.sessionId));

    await appendAuditEvent(tx, {
      actorId: subject.traineeId,
      action: "training_session.cancelled",
      resourceType: "training_session",
      resourceId: input.sessionId,
      requestId: input.requestId,
      idempotencyKey: `audit:training-cancel:${input.sessionId}`,
    });
  });

  return { sessionId: input.sessionId, status: "cancelled" };
}

export async function cancelTrainingSession(
  db: Database,
  input: StudentFacadeInput & { sessionId: string; requestId?: string },
): Promise<{ sessionId: string; status: "cancelled" }> {
  const subject = await resolveTrainingSubject(db, input.studentId);
  return cancelTrainingSessionForSubject(db, {
    subject,
    sessionId: input.sessionId,
    requestId: input.requestId,
  });
}

export async function abandonTrainingSessionForSubject(
  db: Database,
  input: { subject: TrainingSubject; sessionId: string; reason?: string; requestId?: string },
): Promise<{ sessionId: string; status: "abandoned" }> {
  const subject = await authorizeTrainingSubject(db, input.subject);
  const session = await loadOwnedSession(db, subject.traineeId, input.sessionId);

  if (session.status !== "active" && session.status !== "submitted") {
    if (session.status === "abandoned") {
      return { sessionId: input.sessionId, status: "abandoned" };
    }
    throw new TrainingError("SESSION_INVALID_STATE", "Session cannot be abandoned");
  }

  const finishedAt = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(trainingSessions)
      .set({ status: "abandoned", finishedAt })
      .where(eq(trainingSessions.id, input.sessionId));

    await appendAuditEvent(tx, {
      actorId: subject.traineeId,
      action: "training_session.abandoned",
      resourceType: "training_session",
      resourceId: input.sessionId,
      requestId: input.requestId,
      idempotencyKey: `audit:training-abandon:${input.sessionId}`,
      metadata: input.reason ? { reason: input.reason } : undefined,
    });
  });

  return { sessionId: input.sessionId, status: "abandoned" };
}

export async function abandonTrainingSession(
  db: Database,
  input: StudentFacadeInput & { sessionId: string; reason?: string; requestId?: string },
): Promise<{ sessionId: string; status: "abandoned" }> {
  const subject = await resolveTrainingSubject(db, input.studentId);
  return abandonTrainingSessionForSubject(db, {
    subject,
    sessionId: input.sessionId,
    reason: input.reason,
    requestId: input.requestId,
  });
}

async function finalizeInvalidSession(
  db: Database,
  input: SubmitTrainingSessionInput & { reason: string },
): Promise<SubmitTrainingSessionResult> {
  const finishedAt = new Date();
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(trainingSessions)
        .set({
          status: "invalid",
          finishedAt,
          invalidReason: input.reason,
          submitIdempotencyKey: input.idempotencyKey,
        })
        .where(eq(trainingSessions.id, input.sessionId));

      await appendAuditEvent(tx, {
        actorId: input.subject.traineeId,
        action: "training_session.invalid",
        resourceType: "training_session",
        resourceId: input.sessionId,
        requestId: input.requestId,
        idempotencyKey: `audit:training-invalid:${input.subject.traineeId}:${input.idempotencyKey}`,
        metadata: { reason: input.reason },
      });
    });
  } catch (error) {
    if (isPostgresUniqueViolation(error)) {
      return replayOrMismatchOnSubmitKeyConflict(db, input);
    }
    throw error;
  }

  return {
    sessionId: input.sessionId,
    status: "invalid",
    sessionKind: null,
    metrics: [],
    idempotentReplay: false,
  };
}

async function replayOrMismatchOnSubmitKeyConflict(
  db: Database,
  input: SubmitTrainingSessionInput,
): Promise<SubmitTrainingSessionResult> {
  const raced = await findSubmitSessionByIdempotency(
    db,
    input.subject.traineeId,
    input.idempotencyKey,
  );
  if (!raced) {
    throw new Error("Submit idempotency conflict without matching session");
  }

  return resolveSubmitIdempotencyReplay(db, input, raced);
}

export async function submitTrainingSessionForSubject(
  db: Database,
  input: SubmitTrainingSessionInput,
): Promise<SubmitTrainingSessionResult> {
  const subject = await authorizeTrainingSubject(db, input.subject);
  const authorizedInput: SubmitTrainingSessionInput = { ...input, subject };
  await assertSubjectWritable(db, subject);

  const existingBySubmitKey = await findSubmitSessionByIdempotency(
    db,
    subject.traineeId,
    input.idempotencyKey,
  );

  if (existingBySubmitKey) {
    return resolveSubmitIdempotencyReplay(db, authorizedInput, existingBySubmitKey);
  }

  const session = await loadOwnedSession(db, subject.traineeId, input.sessionId);

  if (
    session.status === "completed" ||
    session.status === "invalid" ||
    session.status === "abandoned"
  ) {
    throw new TrainingError("SESSION_ALREADY_COMPLETED", "Session is already finalized");
  }

  if (session.status !== "active") {
    throw new TrainingError("SESSION_INVALID_STATE", "Session is not active");
  }

  if (session.blurAccumulatedMs > TRAINING_BLUR_ABANDON_MS) {
    const finishedAt = new Date();
    try {
      await db
        .update(trainingSessions)
        .set({ status: "abandoned", finishedAt, submitIdempotencyKey: input.idempotencyKey })
        .where(eq(trainingSessions.id, input.sessionId));
    } catch (error) {
      if (isPostgresUniqueViolation(error)) {
        return replayOrMismatchOnSubmitKeyConflict(db, authorizedInput);
      }
      throw error;
    }

    return {
      sessionId: input.sessionId,
      status: "abandoned",
      sessionKind: null,
      metrics: [],
      idempotentReplay: false,
    };
  }

  const events = await loadSessionEvents(db, input.sessionId);
  const definition = await getSessionTrainingDefinition(db, session);
  const schema = resolveDecodedSchema(session.trainingKey, definition.metricSchema ?? {});
  const validation = validateTrainingEvents(session.trainingKey, events, schema);

  if (!validation.valid) {
    return finalizeInvalidSession(db, {
      ...authorizedInput,
      reason: validation.reason,
    });
  }

  const computed = computeTrainingMetrics(session.trainingKey, validation.data, schema);
  if (computed.rejectReason) {
    return finalizeInvalidSession(db, {
      ...authorizedInput,
      reason: computed.rejectReason,
    });
  }

  const metricRows = metricRowsToDbValues(input.sessionId, computed.rows);

  try {
    return await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${buildFullRebuildProjectionLockKey()}))`,
      );
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${buildSubmitCompetitionLockKey(
          subject.traineeId,
          session.trainingKey,
          session.familyDate,
        )}))`,
      );
      await tx.execute(
        sql`SELECT id FROM training_sessions WHERE id = ${input.sessionId} FOR UPDATE`,
      );

      const [lockedSession] = await tx
        .select()
        .from(trainingSessions)
        .where(eq(trainingSessions.id, input.sessionId))
        .limit(1);

      if (!lockedSession || lockedSession.status !== "active") {
        throw new TrainingError("SESSION_INVALID_STATE", "Session is not active");
      }

      const [existingEffective] = await tx
        .select({ id: trainingSessions.id })
        .from(trainingSessions)
        .where(
          and(
            eq(trainingSessions.traineeId, subject.traineeId),
            eq(trainingSessions.trainingKey, lockedSession.trainingKey),
            eq(trainingSessions.familyDate, lockedSession.familyDate),
            eq(trainingSessions.sessionKind, "effective"),
            eq(trainingSessions.status, "completed"),
          ),
        )
        .limit(1);

      const sessionKind = existingEffective ? "practice" : "effective";
      const finishedAt = new Date();

      await tx
        .update(trainingSessions)
        .set({
          status: "submitted",
          submitIdempotencyKey: input.idempotencyKey,
        })
        .where(eq(trainingSessions.id, input.sessionId));

      await tx
        .update(trainingSessions)
        .set({ status: "validated" })
        .where(eq(trainingSessions.id, input.sessionId));

      await tx
        .update(trainingSessions)
        .set({
          status: "completed",
          sessionKind,
          finishedAt,
        })
        .where(eq(trainingSessions.id, input.sessionId));

      await tx.insert(trainingMetrics).values(metricRows);

      const metrics = metricRows.map((row) => ({
        metricKey: row.metricKey,
        value: Number(row.value),
        unit: row.unit,
        isValid: row.isValid === 1,
        calculationVersion: row.calculationVersion,
      }));

      if (sessionKind === "effective") {
        await upsertProfileProjection(tx, {
          subject,
          trainingKey: lockedSession.trainingKey,
          definitionVersion: lockedSession.definitionVersion,
          ageBand: lockedSession.ageBand,
          sessionId: input.sessionId,
          familyDate: lockedSession.familyDate,
          metrics,
        });
      }

      await appendAuditEvent(tx, {
        actorId: subject.traineeId,
        action: "training_session.completed",
        resourceType: "training_session",
        resourceId: input.sessionId,
        requestId: input.requestId,
        idempotencyKey: `audit:training-complete:${subject.traineeId}:${input.idempotencyKey}`,
        metadata: {
          sessionKind,
          trainingKey: lockedSession.trainingKey,
          familyDate: lockedSession.familyDate,
          traineeRole: subject.traineeRole,
        },
      });

      if (subject.traineeRole === "student") {
        await appendOutboxEvent(tx, {
          aggregateType: "training_session",
          aggregateId: input.sessionId,
          eventType: "training_session.completed",
          dedupeKey: `outbox:training-complete:${subject.traineeId}:${input.idempotencyKey}`,
          payload: {
            sessionId: input.sessionId,
            studentId: subject.traineeId,
            traineeId: subject.traineeId,
            trainingKey: lockedSession.trainingKey,
            sessionKind,
            familyDate: lockedSession.familyDate,
          },
        });
      }

      const [finalSession] = await tx
        .select({ sessionKind: trainingSessions.sessionKind })
        .from(trainingSessions)
        .where(eq(trainingSessions.id, input.sessionId))
        .limit(1);

      return {
        sessionId: input.sessionId,
        status: "completed" as const,
        sessionKind: finalSession?.sessionKind ?? sessionKind,
        metrics,
        idempotentReplay: false,
      };
    });
  } catch (error) {
    if (isPostgresUniqueViolation(error)) {
      return replayOrMismatchOnSubmitKeyConflict(db, authorizedInput);
    }
    if (error instanceof TrainingError && error.code === "SESSION_INVALID_STATE") {
      const raced = await findSubmitSessionByIdempotency(
        db,
        subject.traineeId,
        input.idempotencyKey,
      );
      if (raced && raced.id === input.sessionId) {
        return resolveSubmitIdempotencyReplay(db, authorizedInput, raced);
      }
    }
    throw error;
  }
}

export async function submitTrainingSession(
  db: Database,
  input: StudentFacadeInput & {
    sessionId: string;
    idempotencyKey: string;
    requestId?: string;
  },
): Promise<SubmitTrainingSessionResult> {
  const subject = await resolveTrainingSubject(db, input.studentId);
  return submitTrainingSessionForSubject(db, {
    subject,
    sessionId: input.sessionId,
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
  });
}

export async function getTrainingSessionForSubject(
  db: Database,
  claimedSubject: TrainingSubject,
  sessionId: string,
): Promise<TrainingSessionDetail> {
  const subject = await authorizeTrainingSubject(db, claimedSubject);
  await assertSubjectReadable(db, subject);

  const session = await loadOwnedSession(db, subject.traineeId, sessionId);
  const metrics = await loadSessionMetrics(db, sessionId);
  const events = await loadSessionEvents(db, sessionId);

  return {
    sessionId: session.id,
    trainingKey: session.trainingKey,
    definitionVersion: session.definitionVersion,
    ageBand: session.ageBand,
    familyDate: session.familyDate,
    status: session.status,
    sessionKind: session.sessionKind,
    startedAt: session.startedAt.toISOString(),
    finishedAt: session.finishedAt?.toISOString() ?? null,
    blurAccumulatedMs: session.blurAccumulatedMs,
    invalidReason: session.invalidReason,
    metrics,
    eventCount: events.length,
  };
}

export async function getTrainingSessionForStudent(
  db: Database,
  studentId: string,
  sessionId: string,
): Promise<TrainingSessionDetail> {
  const subject = await resolveTrainingSubject(db, studentId);
  return getTrainingSessionForSubject(db, subject, sessionId);
}

export async function getTrainingSummaryForParent(
  db: Database,
  parentId: string,
  studentId: string,
  trainingKey: string = REACTION_TRAINING_KEY,
): Promise<ParentTrainingSummary> {
  await requireActiveRelationship(db, parentId, studentId);
  await assertStudentAccountNotFrozen(db, studentId, "read");

  const summary = await loadTrainingSummaryForTrainee(db, studentId, trainingKey);
  return {
    studentId,
    ...summary,
  };
}

async function loadTrainingSummaryForTrainee(
  db: Database,
  traineeId: string,
  trainingKey: string,
): Promise<Omit<SubjectTrainingSummary, "traineeId">> {
  const [latestSession] = await db
    .select()
    .from(trainingSessions)
    .where(
      and(
        eq(trainingSessions.traineeId, traineeId),
        eq(trainingSessions.trainingKey, trainingKey),
        eq(trainingSessions.status, "completed"),
      ),
    )
    .orderBy(sql`${trainingSessions.finishedAt} DESC NULLS LAST`)
    .limit(1);

  const projectionRows = await db
    .select()
    .from(trainingProfileProjection)
    .where(
      and(
        eq(trainingProfileProjection.traineeId, traineeId),
        eq(trainingProfileProjection.trainingKey, trainingKey),
      ),
    );

  const projectionMetricKeys = new Set(
    getProjectionMetricDefinitions(trainingKey).map((definition) => definition.metricKey),
  );

  let lastSession: SubjectTrainingSummary["lastSession"] = null;
  if (latestSession) {
    const metrics = await loadSessionMetrics(db, latestSession.id);
    lastSession = {
      sessionId: latestSession.id,
      status: latestSession.status,
      sessionKind: latestSession.sessionKind,
      finishedAt: latestSession.finishedAt?.toISOString() ?? null,
      metrics: metrics.filter((metric) => projectionMetricKeys.has(metric.metricKey)),
    };
  }

  return {
    trainingKey,
    definitionVersion:
      latestSession?.definitionVersion ?? projectionRows[0]?.definitionVersion ?? 1,
    ageBand: latestSession?.ageBand ?? projectionRows[0]?.ageBand ?? "9-12",
    familyDate: latestSession?.familyDate ?? toFamilyDate(),
    lastSession,
    projection: projectionRows
      .filter((row) => projectionMetricKeys.has(row.metricKey))
      .map((row) => ({
        metricKey: row.metricKey,
        bestValue: Number(row.bestValue),
        lastValue: Number(row.lastValue),
      })),
  };
}

export async function getTrainingSummaryForSubject(
  db: Database,
  claimedSubject: TrainingSubject,
  trainingKey: string = REACTION_TRAINING_KEY,
): Promise<SubjectTrainingSummary> {
  const subject = await authorizeTrainingSubject(db, claimedSubject);
  await assertSubjectReadable(db, subject);

  const summary = await loadTrainingSummaryForTrainee(db, subject.traineeId, trainingKey);
  return {
    traineeId: subject.traineeId,
    ...summary,
  };
}

export async function getOwnTrainingTrendsForSubject(
  db: Database,
  claimedSubject: TrainingSubject,
  input: {
    trainingKey: string;
    window: TrendWindow;
    referenceFamilyDate?: string;
  },
): Promise<SubjectTrainingTrends> {
  const subject = await authorizeTrainingSubject(db, claimedSubject);
  await assertSubjectReadable(db, subject);

  const trends = await queryTrainingTrends(db, {
    studentId: subject.traineeId,
    trainingKey: input.trainingKey,
    window: input.window,
    referenceFamilyDate: input.referenceFamilyDate,
  });

  const { studentId: _ignoredStudentId, ...rest } = trends;
  void _ignoredStudentId;
  return {
    traineeId: subject.traineeId,
    ...rest,
  };
}
