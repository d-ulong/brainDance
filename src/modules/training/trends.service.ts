import { and, asc, eq, gte, inArray, lte, notInArray, sql } from "drizzle-orm";

import { buildFullRebuildProjectionLockKey } from "@/modules/training/submit-competition-lock-key";

import type { Database } from "@/db";
import {
  trainingEvents,
  trainingDefinitions,
  trainingMetrics,
  trainingProfileProjection,
  trainingSessions,
} from "@/db/schema";
import { DIGIT_SPAN_TRAINING_KEY } from "@/modules/training/constants";
import {
  decodeDigitSpanMetricSchema,
  type DigitSpanAttemptRecord,
  validateDigitSpanEvents,
} from "@/modules/training/digit-span-v1";
import {
  mergeMetricIntoProjectionState,
  type ProjectionMetricInput,
  type ProjectionRowState,
} from "@/modules/training/profile-projection-reducer";
import type { TrainingEventRecord } from "@/modules/training/protocol";
import { resolveTrendWindowStart, type TrendWindow } from "@/modules/training/trend-window";
import { toFamilyDate } from "@/modules/time-policy/to-family-date";
import { assertStudentAccountNotFrozen } from "@/modules/data-lifecycle/freeze-guard.service";

export type TrainingTrendMetric = {
  metricKey: string;
  value: number;
  unit: string;
};

export type DigitSpanAttemptSummary = {
  mode: "forward" | "backward";
  length: number;
  attemptIndex: number;
  correct: boolean;
};

export type TrainingTrendPoint = {
  sessionId: string;
  familyDate: string;
  sessionKind: "effective";
  metrics: TrainingTrendMetric[];
  digitSpanAttempts?: DigitSpanAttemptSummary[];
};

export type TrainingTrendSegmentReason =
  "initial" | "definition_version_change" | "age_band_change";

export type TrainingTrendSegment = {
  definitionVersion: number;
  ageBand: string;
  segmentReason: TrainingTrendSegmentReason | null;
  points: TrainingTrendPoint[];
};

export type TrainingTrendsResponse = {
  studentId: string;
  trainingKey: string;
  window: TrendWindow;
  referenceFamilyDate: string;
  windowStartFamilyDate: string | null;
  hasData: boolean;
  partialCoverage: boolean;
  segments: TrainingTrendSegment[];
};

type EffectiveSessionRow = typeof trainingSessions.$inferSelect;

function segmentIdentityKey(definitionVersion: number, ageBand: string): string {
  return `${definitionVersion}:${ageBand}`;
}

function compareSegmentOrder(
  left: { definitionVersion: number; ageBand: string; firstFamilyDate: string },
  right: { definitionVersion: number; ageBand: string; firstFamilyDate: string },
): number {
  if (left.firstFamilyDate !== right.firstFamilyDate) {
    return left.firstFamilyDate.localeCompare(right.firstFamilyDate);
  }
  if (left.definitionVersion !== right.definitionVersion) {
    return left.definitionVersion - right.definitionVersion;
  }
  return left.ageBand.localeCompare(right.ageBand);
}

async function loadEffectiveSessions(
  db: Database,
  traineeId: string,
  trainingKey: string,
  start: string | null = null,
  end?: string,
): Promise<EffectiveSessionRow[]> {
  return db
    .select()
    .from(trainingSessions)
    .where(
      and(
        eq(trainingSessions.traineeId, traineeId),
        eq(trainingSessions.trainingKey, trainingKey),
        eq(trainingSessions.status, "completed"),
        eq(trainingSessions.sessionKind, "effective"),
        start ? gte(trainingSessions.familyDate, start) : undefined,
        end ? lte(trainingSessions.familyDate, end) : undefined,
      ),
    )
    .orderBy(asc(trainingSessions.familyDate), asc(trainingSessions.finishedAt));
}

function toDigitSpanAttemptSummaries(
  attempts: DigitSpanAttemptRecord[],
): DigitSpanAttemptSummary[] {
  return attempts.map((attempt) => ({
    mode: attempt.mode,
    length: attempt.length,
    attemptIndex: attempt.attemptIndex,
    correct: attempt.correct,
  }));
}

function resolveSegmentReason(
  previous: { definitionVersion: number; ageBand: string } | null,
  current: { definitionVersion: number; ageBand: string },
): TrainingTrendSegmentReason | null {
  if (!previous) {
    return "initial";
  }
  if (current.definitionVersion !== previous.definitionVersion) {
    return "definition_version_change";
  }
  if (current.ageBand !== previous.ageBand) {
    return "age_band_change";
  }
  return null;
}

export async function queryTrainingTrends(
  db: Database,
  input: {
    studentId: string;
    trainingKey: string;
    window: TrendWindow;
    referenceFamilyDate?: string;
  },
): Promise<TrainingTrendsResponse> {
  await assertStudentAccountNotFrozen(db, input.studentId, "read");

  const referenceFamilyDate = input.referenceFamilyDate ?? toFamilyDate();
  const windowStartFamilyDate = resolveTrendWindowStart(input.window, referenceFamilyDate);
  const windowSessions = await loadEffectiveSessions(
    db,
    input.studentId,
    input.trainingKey,
    windowStartFamilyDate,
    input.window === "all" ? undefined : referenceFamilyDate,
  );
  const outside = windowStartFamilyDate
    ? await db
        .select({ id: trainingSessions.id })
        .from(trainingSessions)
        .where(
          and(
            eq(trainingSessions.traineeId, input.studentId),
            eq(trainingSessions.trainingKey, input.trainingKey),
            eq(trainingSessions.status, "completed"),
            eq(trainingSessions.sessionKind, "effective"),
            sql`(${trainingSessions.familyDate} < ${windowStartFamilyDate}::date OR ${trainingSessions.familyDate} > ${referenceFamilyDate}::date)`,
          ),
        )
        .limit(1)
    : [];
  const hasHistoricalOutsideWindow = outside.length > 0;
  const metricsBySession = new Map<string, TrainingTrendMetric[]>();
  const eventsBySession = new Map<string, TrainingEventRecord[]>();
  const definitionById = new Map<string, typeof trainingDefinitions.$inferSelect>();
  // Bounded IN batches avoid both per-session N+1 and oversized query parameters.
  for (let offset = 0; offset < windowSessions.length; offset += 200) {
    const batch = windowSessions.slice(offset, offset + 200);
    const metrics = await db
      .select()
      .from(trainingMetrics)
      .where(
        and(
          inArray(
            trainingMetrics.sessionId,
            batch.map((row) => row.id),
          ),
          eq(trainingMetrics.isValid, 1),
        ),
      );
    for (const row of metrics) {
      const values = metricsBySession.get(row.sessionId) ?? [];
      values.push({ metricKey: row.metricKey, value: Number(row.value), unit: row.unit });
      metricsBySession.set(row.sessionId, values);
    }
    const digits = batch.filter((row) => row.trainingKey === DIGIT_SPAN_TRAINING_KEY);
    if (digits.length) {
      const events = await db
        .select()
        .from(trainingEvents)
        .where(
          inArray(
            trainingEvents.sessionId,
            digits.map((row) => row.id),
          ),
        )
        .orderBy(asc(trainingEvents.sequence));
      for (const row of events) {
        const values = eventsBySession.get(row.sessionId) ?? [];
        values.push(row);
        eventsBySession.set(row.sessionId, values);
      }
      const definitions = await db
        .select()
        .from(trainingDefinitions)
        .where(
          inArray(trainingDefinitions.id, [...new Set(digits.map((row) => row.definitionId))]),
        );
      for (const row of definitions) definitionById.set(row.id, row);
    }
  }

  const segmentBuckets = new Map<
    string,
    {
      definitionVersion: number;
      ageBand: string;
      firstFamilyDate: string;
      points: TrainingTrendPoint[];
    }
  >();

  for (const session of windowSessions) {
    const metrics = metricsBySession.get(session.id) ?? [];
    let digitSpanAttempts: DigitSpanAttemptSummary[] | undefined;
    const definition = definitionById.get(session.definitionId);
    if (
      definition &&
      definition.trainingKey === session.trainingKey &&
      definition.version === session.definitionVersion &&
      definition.ageBand === session.ageBand
    ) {
      const schema = decodeDigitSpanMetricSchema(definition.metricSchema ?? {});
      if (schema) {
        const validated = validateDigitSpanEvents(eventsBySession.get(session.id) ?? [], schema);
        if (validated.valid)
          digitSpanAttempts = toDigitSpanAttemptSummaries(validated.data.attempts);
      }
    }
    const point: TrainingTrendPoint = {
      sessionId: session.id,
      familyDate: session.familyDate,
      sessionKind: "effective",
      metrics,
      ...(digitSpanAttempts ? { digitSpanAttempts } : {}),
    };

    const key = segmentIdentityKey(session.definitionVersion, session.ageBand);
    const existing = segmentBuckets.get(key);
    if (existing) {
      existing.points.push(point);
      if (session.familyDate < existing.firstFamilyDate) {
        existing.firstFamilyDate = session.familyDate;
      }
    } else {
      segmentBuckets.set(key, {
        definitionVersion: session.definitionVersion,
        ageBand: session.ageBand,
        firstFamilyDate: session.familyDate,
        points: [point],
      });
    }
  }

  const orderedSegments = [...segmentBuckets.values()].sort(compareSegmentOrder);
  const segments: TrainingTrendSegment[] = [];
  let previousSegment: { definitionVersion: number; ageBand: string } | null = null;

  for (const bucket of orderedSegments) {
    segments.push({
      definitionVersion: bucket.definitionVersion,
      ageBand: bucket.ageBand,
      segmentReason: resolveSegmentReason(previousSegment, bucket),
      points: bucket.points,
    });
    previousSegment = {
      definitionVersion: bucket.definitionVersion,
      ageBand: bucket.ageBand,
    };
  }

  return {
    studentId: input.studentId,
    trainingKey: input.trainingKey,
    window: input.window,
    referenceFamilyDate,
    windowStartFamilyDate,
    hasData: windowSessions.length > 0,
    partialCoverage: hasHistoricalOutsideWindow,
    segments,
  };
}

export async function loadTrainingProfileProjectionRows(
  db: Database,
  studentId: string,
  trainingKey?: string,
) {
  const conditions = [eq(trainingProfileProjection.traineeId, studentId)];
  if (trainingKey) {
    conditions.push(eq(trainingProfileProjection.trainingKey, trainingKey));
  }

  return db
    .select()
    .from(trainingProfileProjection)
    .where(and(...conditions))
    .orderBy(
      asc(trainingProfileProjection.trainingKey),
      asc(trainingProfileProjection.definitionVersion),
      asc(trainingProfileProjection.ageBand),
      asc(trainingProfileProjection.metricKey),
    );
}

export function projectionRowsEquivalent(
  left: Array<{
    trainingKey: string;
    definitionVersion: number;
    ageBand: string;
    metricKey: string;
    bestValue: string | number;
    lastValue: string | number;
    lastSourceSessionId: string | null;
    windowSummary?: unknown;
  }>,
  right: Array<{
    trainingKey: string;
    definitionVersion: number;
    ageBand: string;
    metricKey: string;
    bestValue: string | number;
    lastValue: string | number;
    lastSourceSessionId: string | null;
    windowSummary?: unknown;
  }>,
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  const normalize = (
    rows: Array<{
      trainingKey: string;
      definitionVersion: number;
      ageBand: string;
      metricKey: string;
      bestValue: string | number;
      lastValue: string | number;
      lastSourceSessionId: string | null;
      windowSummary?: unknown;
    }>,
  ) =>
    rows
      .map((row) => {
        const windowSummary = row.windowSummary as { lastFamilyDate?: string } | null | undefined;
        return {
          trainingKey: row.trainingKey,
          definitionVersion: row.definitionVersion,
          ageBand: row.ageBand,
          metricKey: row.metricKey,
          bestValue: Number(row.bestValue).toFixed(6),
          lastValue: Number(row.lastValue).toFixed(6),
          lastSourceSessionId: row.lastSourceSessionId,
          lastFamilyDate: windowSummary?.lastFamilyDate ?? null,
        };
      })
      .sort((a, b) =>
        `${a.trainingKey}:${a.definitionVersion}:${a.ageBand}:${a.metricKey}`.localeCompare(
          `${b.trainingKey}:${b.definitionVersion}:${b.ageBand}:${b.metricKey}`,
        ),
      );

  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);

  return normalizedLeft.every((row, index) => {
    const other = normalizedRight[index];
    return (
      row.trainingKey === other.trainingKey &&
      row.definitionVersion === other.definitionVersion &&
      row.ageBand === other.ageBand &&
      row.metricKey === other.metricKey &&
      row.bestValue === other.bestValue &&
      row.lastValue === other.lastValue &&
      row.lastSourceSessionId === other.lastSourceSessionId &&
      row.lastFamilyDate === other.lastFamilyDate
    );
  });
}

export type RebuildTrainingProfileProjectionTestHooks = {
  beforeOrphanCleanup?: () => Promise<void>;
};

async function acquireFullRebuildProjectionLock(tx: Database): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${buildFullRebuildProjectionLockKey()}))`,
  );
}

export async function rebuildTrainingProfileProjectionForStudent(
  tx: Database,
  studentId: string,
  now: Date = new Date(),
): Promise<{ sessionsScanned: number; projectionRowsWritten: number }> {
  return rebuildTrainingProfileProjectionForTrainee(tx, studentId, now);
}

export async function rebuildTrainingProfileProjectionForTrainee(
  tx: Database,
  traineeId: string,
  now: Date = new Date(),
): Promise<{ sessionsScanned: number; projectionRowsWritten: number }> {
  const sessions = await tx
    .select()
    .from(trainingSessions)
    .where(
      and(
        eq(trainingSessions.traineeId, traineeId),
        eq(trainingSessions.status, "completed"),
        eq(trainingSessions.sessionKind, "effective"),
      ),
    )
    .orderBy(asc(trainingSessions.finishedAt), asc(trainingSessions.id));

  const segmentStates = new Map<
    string,
    {
      trainingKey: string;
      definitionVersion: number;
      ageBand: string;
      metrics: Map<string, ProjectionRowState>;
    }
  >();

  for (const session of sessions) {
    const metricRows = await tx
      .select()
      .from(trainingMetrics)
      .where(eq(trainingMetrics.sessionId, session.id));

    const metrics: ProjectionMetricInput[] = metricRows.map((row) => ({
      metricKey: row.metricKey,
      value: Number(row.value),
      isValid: row.isValid === 1,
    }));

    const segmentKey = `${session.trainingKey}:${session.definitionVersion}:${session.ageBand}`;
    let segment = segmentStates.get(segmentKey);
    if (!segment) {
      segment = {
        trainingKey: session.trainingKey,
        definitionVersion: session.definitionVersion,
        ageBand: session.ageBand,
        metrics: new Map(),
      };
      segmentStates.set(segmentKey, segment);
    }

    mergeMetricIntoProjectionState(segment.metrics, {
      trainingKey: session.trainingKey,
      sessionId: session.id,
      familyDate: session.familyDate,
      metrics,
    });
  }

  await tx
    .delete(trainingProfileProjection)
    .where(eq(trainingProfileProjection.traineeId, traineeId));

  const compatStudentId = sessions.find((session) => session.studentId != null)?.studentId ?? null;

  let projectionRowsWritten = 0;
  for (const segment of segmentStates.values()) {
    for (const row of segment.metrics.values()) {
      await tx.insert(trainingProfileProjection).values({
        traineeId,
        studentId: compatStudentId,
        trainingKey: segment.trainingKey,
        definitionVersion: segment.definitionVersion,
        ageBand: segment.ageBand,
        metricKey: row.metricKey,
        bestValue: row.bestValue.toFixed(6),
        lastValue: row.lastValue.toFixed(6),
        lastSourceSessionId: row.lastSourceSessionId,
        windowSummary: { lastFamilyDate: row.lastFamilyDate },
        updatedAt: now,
      });
      projectionRowsWritten += 1;
    }
  }

  return {
    sessionsScanned: sessions.length,
    projectionRowsWritten,
  };
}

export async function rebuildTrainingProfileProjection(
  db: Database,
  options?: {
    studentId?: string;
    now?: Date;
    testHooks?: RebuildTrainingProfileProjectionTestHooks;
  },
): Promise<{
  studentsScanned: number;
  sessionsScanned: number;
  projectionRowsWritten: number;
}> {
  const now = options?.now ?? new Date();

  if (options?.studentId) {
    return db.transaction(async (tx) => {
      await acquireFullRebuildProjectionLock(tx);
      const result = await rebuildTrainingProfileProjectionForStudent(tx, options.studentId!, now);
      return {
        studentsScanned: 1,
        sessionsScanned: result.sessionsScanned,
        projectionRowsWritten: result.projectionRowsWritten,
      };
    });
  }

  let sessionsScanned = 0;
  let projectionRowsWritten = 0;
  let studentsScanned = 0;

  await db.transaction(async (tx) => {
    await acquireFullRebuildProjectionLock(tx);

    const studentRows = await tx.execute(sql`
      SELECT DISTINCT trainee_id
      FROM training_sessions
      WHERE status = 'completed' AND session_kind = 'effective'
      ORDER BY trainee_id
    `);

    const studentIds = (studentRows as unknown as { trainee_id: string }[]).map(
      (row) => row.trainee_id,
    );
    studentsScanned = studentIds.length;

    for (const studentId of studentIds) {
      const result = await rebuildTrainingProfileProjectionForTrainee(tx, studentId, now);
      sessionsScanned += result.sessionsScanned;
      projectionRowsWritten += result.projectionRowsWritten;
    }

    if (options?.testHooks?.beforeOrphanCleanup) {
      await options.testHooks.beforeOrphanCleanup();
    }

    if (studentIds.length === 0) {
      await tx.delete(trainingProfileProjection);
    } else {
      await tx
        .delete(trainingProfileProjection)
        .where(notInArray(trainingProfileProjection.traineeId, studentIds));
    }
  });

  return {
    studentsScanned,
    sessionsScanned,
    projectionRowsWritten,
  };
}
