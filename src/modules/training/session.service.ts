import { and, asc, eq, sql } from "drizzle-orm";

import type { Database } from "@/db";
import {
  trainingEvents,
  trainingMetrics,
  trainingProfileProjection,
  trainingSessions,
  users,
} from "@/db/schema";
import { appendAuditEvent } from "@/modules/audit/append-audit-event";
import { appendOutboxEvent } from "@/modules/outbox/append-outbox-event";
import { requireActiveRelationship } from "@/modules/family-access/authorization.service";
import {
  getActiveTrainingDefinition,
  getSessionTrainingDefinition,
} from "@/modules/training/definition.service";
import { REACTION_TRAINING_KEY, TRAINING_BLUR_ABANDON_MS } from "@/modules/training/constants";
import { buildSubmitCompetitionLockKey } from "@/modules/training/submit-competition-lock-key";
import { TrainingError } from "@/modules/training/errors";
import {
  computeTrainingMetrics,
  decodeMetricSchema,
  getExpectedSessionCount,
  getMetricDefinitions,
  getTrainingProtocol,
  metricRowsToDbValues,
  validateTrainingEvents,
} from "@/modules/training/protocol";
import { resolveAgeBand, type AgeBand } from "@/modules/time-policy/resolve-age-band";
import { toFamilyDate } from "@/modules/time-policy/to-family-date";
import { isPostgresUniqueViolation } from "@/lib/postgres-errors";

export type StartTrainingSessionInput = {
  studentId: string;
  trainingKey: string;
  idempotencyKey: string;
  requestId?: string;
};

export type StartTrainingSessionResult = {
  sessionId: string;
  trainingKey: string;
  definitionVersion: number;
  ageBand: AgeBand;
  familyDate: string;
  expectedTrialCount: number;
  status: "active";
  idempotentReplay: boolean;
};

export type AppendTrainingEventInput = {
  studentId: string;
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
  studentId: string;
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

async function resolveStudentAgeBand(db: Database, studentId: string): Promise<AgeBand> {
  const [student] = await db.select().from(users).where(eq(users.id, studentId)).limit(1);
  if (!student) {
    throw new TrainingError("USER_NOT_FOUND", "Student not found");
  }
  if (!student.birthDate) {
    throw new TrainingError("STUDENT_BIRTH_DATE_REQUIRED", "Student birth date is required");
  }

  return resolveAgeBand(new Date(`${student.birthDate}T12:00:00.000Z`));
}

async function loadOwnedSession(db: Database, studentId: string, sessionId: string) {
  const [session] = await db
    .select()
    .from(trainingSessions)
    .where(and(eq(trainingSessions.id, sessionId), eq(trainingSessions.studentId, studentId)))
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
    studentId: string;
    trainingKey: string;
    definitionVersion: number;
    ageBand: string;
    sessionId: string;
    metrics: TrainingMetricDto[];
  },
) {
  const metricDefinitions = getMetricDefinitions(input.trainingKey);
  const directionByKey = new Map(
    metricDefinitions.map((definition) => [definition.metricKey, definition.direction]),
  );
  const excluded = new Set(
    metricDefinitions
      .filter((definition) => definition.excludeFromProjection)
      .map((d) => d.metricKey),
  );

  for (const metric of input.metrics) {
    if (!metric.isValid || excluded.has(metric.metricKey)) {
      continue;
    }

    const direction = directionByKey.get(metric.metricKey);
    const lowerIsBetter = direction === "lower-is-better";
    const [existing] = await tx
      .select()
      .from(trainingProfileProjection)
      .where(
        and(
          eq(trainingProfileProjection.studentId, input.studentId),
          eq(trainingProfileProjection.trainingKey, input.trainingKey),
          eq(trainingProfileProjection.definitionVersion, input.definitionVersion),
          eq(trainingProfileProjection.ageBand, input.ageBand),
          eq(trainingProfileProjection.metricKey, metric.metricKey),
        ),
      )
      .limit(1);

    const bestValue =
      existing === undefined
        ? metric.value
        : lowerIsBetter
          ? Math.min(Number(existing.bestValue), metric.value)
          : Math.max(Number(existing.bestValue), metric.value);

    await tx
      .insert(trainingProfileProjection)
      .values({
        studentId: input.studentId,
        trainingKey: input.trainingKey,
        definitionVersion: input.definitionVersion,
        ageBand: input.ageBand,
        metricKey: metric.metricKey,
        bestValue: bestValue.toFixed(6),
        lastValue: metric.value.toFixed(6),
        lastSourceSessionId: input.sessionId,
        windowSummary: { lastFamilyDate: toFamilyDate() },
      })
      .onConflictDoUpdate({
        target: [
          trainingProfileProjection.studentId,
          trainingProfileProjection.trainingKey,
          trainingProfileProjection.definitionVersion,
          trainingProfileProjection.ageBand,
          trainingProfileProjection.metricKey,
        ],
        set: {
          bestValue: bestValue.toFixed(6),
          lastValue: metric.value.toFixed(6),
          lastSourceSessionId: input.sessionId,
          updatedAt: new Date(),
        },
      });
  }
}

async function findStartSessionByIdempotency(
  db: Database,
  studentId: string,
  idempotencyKey: string,
) {
  const [existing] = await db
    .select()
    .from(trainingSessions)
    .where(
      and(
        eq(trainingSessions.studentId, studentId),
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
    ageBand: existing.ageBand as AgeBand,
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
  studentId: string,
  idempotencyKey: string,
) {
  const [existing] = await db
    .select()
    .from(trainingSessions)
    .where(
      and(
        eq(trainingSessions.studentId, studentId),
        eq(trainingSessions.submitIdempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);

  return existing;
}

export async function startTrainingSession(
  db: Database,
  input: StartTrainingSessionInput,
): Promise<StartTrainingSessionResult> {
  const existing = await findStartSessionByIdempotency(db, input.studentId, input.idempotencyKey);

  if (existing) {
    return buildStartReplayResult(db, existing);
  }

  const ageBand = await resolveStudentAgeBand(db, input.studentId);
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

  try {
    const [created] = await db
      .insert(trainingSessions)
      .values({
        studentId: input.studentId,
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

    await appendAuditEvent(db, {
      actorId: input.studentId,
      action: "training_session.started",
      resourceType: "training_session",
      resourceId: created.id,
      requestId: input.requestId,
      idempotencyKey: `audit:training-start:${input.studentId}:${input.idempotencyKey}`,
      metadata: {
        trainingKey: input.trainingKey,
        familyDate,
        ageBand,
      },
    });

    return {
      sessionId: created.id,
      trainingKey: created.trainingKey,
      definitionVersion: created.definitionVersion,
      ageBand: created.ageBand as AgeBand,
      familyDate: created.familyDate,
      expectedTrialCount: getExpectedSessionCount(created.trainingKey, schema),
      status: "active",
      idempotentReplay: false,
    };
  } catch (error) {
    if (!isPostgresUniqueViolation(error)) {
      throw error;
    }

    const raced = await findStartSessionByIdempotency(db, input.studentId, input.idempotencyKey);
    if (!raced) {
      throw error;
    }

    return buildStartReplayResult(db, raced);
  }
}

export async function appendTrainingEvent(
  db: Database,
  input: AppendTrainingEventInput,
): Promise<AppendTrainingEventResult> {
  const session = await loadOwnedSession(db, input.studentId, input.sessionId);

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

export async function cancelTrainingSession(
  db: Database,
  input: { studentId: string; sessionId: string; requestId?: string },
): Promise<{ sessionId: string; status: "cancelled" }> {
  const session = await loadOwnedSession(db, input.studentId, input.sessionId);

  if (session.status !== "active") {
    throw new TrainingError("SESSION_INVALID_STATE", "Only active sessions can be cancelled");
  }

  const finishedAt = new Date();
  await db
    .update(trainingSessions)
    .set({ status: "cancelled", finishedAt })
    .where(eq(trainingSessions.id, input.sessionId));

  await appendAuditEvent(db, {
    actorId: input.studentId,
    action: "training_session.cancelled",
    resourceType: "training_session",
    resourceId: input.sessionId,
    requestId: input.requestId,
    idempotencyKey: `audit:training-cancel:${input.sessionId}`,
  });

  return { sessionId: input.sessionId, status: "cancelled" };
}

export async function abandonTrainingSession(
  db: Database,
  input: { studentId: string; sessionId: string; reason?: string; requestId?: string },
): Promise<{ sessionId: string; status: "abandoned" }> {
  const session = await loadOwnedSession(db, input.studentId, input.sessionId);

  if (session.status !== "active" && session.status !== "submitted") {
    if (session.status === "abandoned") {
      return { sessionId: input.sessionId, status: "abandoned" };
    }
    throw new TrainingError("SESSION_INVALID_STATE", "Session cannot be abandoned");
  }

  const finishedAt = new Date();
  await db
    .update(trainingSessions)
    .set({ status: "abandoned", finishedAt })
    .where(eq(trainingSessions.id, input.sessionId));

  await appendAuditEvent(db, {
    actorId: input.studentId,
    action: "training_session.abandoned",
    resourceType: "training_session",
    resourceId: input.sessionId,
    requestId: input.requestId,
    idempotencyKey: `audit:training-abandon:${input.sessionId}`,
    metadata: input.reason ? { reason: input.reason } : undefined,
  });

  return { sessionId: input.sessionId, status: "abandoned" };
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
        actorId: input.studentId,
        action: "training_session.invalid",
        resourceType: "training_session",
        resourceId: input.sessionId,
        requestId: input.requestId,
        idempotencyKey: `audit:training-invalid:${input.studentId}:${input.idempotencyKey}`,
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
  const raced = await findSubmitSessionByIdempotency(db, input.studentId, input.idempotencyKey);
  if (!raced) {
    throw new Error("Submit idempotency conflict without matching session");
  }

  return resolveSubmitIdempotencyReplay(db, input, raced);
}

export async function submitTrainingSession(
  db: Database,
  input: SubmitTrainingSessionInput,
): Promise<SubmitTrainingSessionResult> {
  const existingBySubmitKey = await findSubmitSessionByIdempotency(
    db,
    input.studentId,
    input.idempotencyKey,
  );

  if (existingBySubmitKey) {
    return resolveSubmitIdempotencyReplay(db, input, existingBySubmitKey);
  }

  const session = await loadOwnedSession(db, input.studentId, input.sessionId);

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
        return replayOrMismatchOnSubmitKeyConflict(db, input);
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
      ...input,
      reason: validation.reason,
    });
  }

  const computed = computeTrainingMetrics(session.trainingKey, validation.data, schema);
  if (computed.rejectReason) {
    return finalizeInvalidSession(db, {
      ...input,
      reason: computed.rejectReason,
    });
  }

  const metricRows = metricRowsToDbValues(input.sessionId, computed.rows);

  try {
    return await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${buildSubmitCompetitionLockKey(
          input.studentId,
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
            eq(trainingSessions.studentId, input.studentId),
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
          studentId: input.studentId,
          trainingKey: lockedSession.trainingKey,
          definitionVersion: lockedSession.definitionVersion,
          ageBand: lockedSession.ageBand,
          sessionId: input.sessionId,
          metrics,
        });
      }

      await appendAuditEvent(tx, {
        actorId: input.studentId,
        action: "training_session.completed",
        resourceType: "training_session",
        resourceId: input.sessionId,
        requestId: input.requestId,
        idempotencyKey: `audit:training-complete:${input.studentId}:${input.idempotencyKey}`,
        metadata: {
          sessionKind,
          trainingKey: lockedSession.trainingKey,
          familyDate: lockedSession.familyDate,
        },
      });

      await appendOutboxEvent(tx, {
        aggregateType: "training_session",
        aggregateId: input.sessionId,
        eventType: "training_session.completed",
        dedupeKey: `outbox:training-complete:${input.studentId}:${input.idempotencyKey}`,
        payload: {
          sessionId: input.sessionId,
          studentId: input.studentId,
          trainingKey: lockedSession.trainingKey,
          sessionKind,
          familyDate: lockedSession.familyDate,
        },
      });

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
      return replayOrMismatchOnSubmitKeyConflict(db, input);
    }
    if (error instanceof TrainingError && error.code === "SESSION_INVALID_STATE") {
      const raced = await findSubmitSessionByIdempotency(db, input.studentId, input.idempotencyKey);
      if (raced && raced.id === input.sessionId) {
        return resolveSubmitIdempotencyReplay(db, input, raced);
      }
    }
    throw error;
  }
}

export async function getTrainingSessionForStudent(
  db: Database,
  studentId: string,
  sessionId: string,
): Promise<TrainingSessionDetail> {
  const session = await loadOwnedSession(db, studentId, sessionId);
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

export async function getTrainingSummaryForParent(
  db: Database,
  parentId: string,
  studentId: string,
  trainingKey: string = REACTION_TRAINING_KEY,
): Promise<ParentTrainingSummary> {
  await requireActiveRelationship(db, parentId, studentId);

  const [latestSession] = await db
    .select()
    .from(trainingSessions)
    .where(
      and(
        eq(trainingSessions.studentId, studentId),
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
        eq(trainingProfileProjection.studentId, studentId),
        eq(trainingProfileProjection.trainingKey, trainingKey),
      ),
    );

  let lastSession: ParentTrainingSummary["lastSession"] = null;
  if (latestSession) {
    const metrics = await loadSessionMetrics(db, latestSession.id);
    lastSession = {
      sessionId: latestSession.id,
      status: latestSession.status,
      sessionKind: latestSession.sessionKind,
      finishedAt: latestSession.finishedAt?.toISOString() ?? null,
      metrics: metrics.filter((m) => ["median_reaction_ms", "accuracy"].includes(m.metricKey)),
    };
  }

  return {
    studentId,
    trainingKey,
    definitionVersion:
      latestSession?.definitionVersion ?? projectionRows[0]?.definitionVersion ?? 1,
    ageBand: latestSession?.ageBand ?? projectionRows[0]?.ageBand ?? "9-12",
    familyDate: latestSession?.familyDate ?? toFamilyDate(),
    lastSession,
    projection: projectionRows
      .filter((row) => ["median_reaction_ms", "accuracy"].includes(row.metricKey))
      .map((row) => ({
        metricKey: row.metricKey,
        bestValue: Number(row.bestValue),
        lastValue: Number(row.lastValue),
      })),
  };
}
