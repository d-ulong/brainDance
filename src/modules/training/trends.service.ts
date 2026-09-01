import { and, asc, eq, notInArray, sql } from "drizzle-orm";

import { buildFullRebuildProjectionLockKey } from "@/modules/training/submit-competition-lock-key";

import type { Database } from "@/db";
import {
  trainingEvents,
  trainingMetrics,
  trainingProfileProjection,
  trainingSessions,
} from "@/db/schema";
import { DIGIT_SPAN_TRAINING_KEY } from "@/modules/training/constants";
import { getSessionTrainingDefinition } from "@/modules/training/definition.service";
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
import {
  isFamilyDateInTrendWindow,
  resolveTrendWindowStart,
  type TrendWindow,
} from "@/modules/training/trend-window";
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
  studentId: string,
  trainingKey: string,
): Promise<EffectiveSessionRow[]> {
  return db
    .select()
    .from(trainingSessions)
    .where(
      and(
        eq(trainingSessions.studentId, studentId),
        eq(trainingSessions.trainingKey, trainingKey),
        eq(trainingSessions.status, "completed"),
        eq(trainingSessions.sessionKind, "effective"),
      ),
    )
    .orderBy(asc(trainingSessions.familyDate), asc(trainingSessions.finishedAt));
}

async function loadSessionMetricsForTrend(
  db: Database,
  sessionId: string,
): Promise<TrainingTrendMetric[]> {
  const rows = await db
    .select()
    .from(trainingMetrics)
    .where(and(eq(trainingMetrics.sessionId, sessionId), eq(trainingMetrics.isValid, 1)));

  return rows.map((row) => ({
    metricKey: row.metricKey,
    value: Number(row.value),
    unit: row.unit,
  }));
}

async function loadSessionEvents(db: Database, sessionId: string): Promise<TrainingEventRecord[]> {
  const rows = await db
    .select({
      sequence: trainingEvents.sequence,
      eventType: trainingEvents.eventType,
      payload: trainingEvents.payload,
      occurredAt: trainingEvents.occurredAt,
    })
    .from(trainingEvents)
    .where(eq(trainingEvents.sessionId, sessionId))
    .orderBy(asc(trainingEvents.sequence));

  return rows;
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

async function loadDigitSpanAttemptSummaries(
  db: Database,
  session: EffectiveSessionRow,
): Promise<DigitSpanAttemptSummary[] | undefined> {
  if (session.trainingKey !== DIGIT_SPAN_TRAINING_KEY) {
    return undefined;
  }

  const definition = await getSessionTrainingDefinition(db, session);
  const schema = decodeDigitSpanMetricSchema(definition.metricSchema ?? {});
  if (!schema) {
    return undefined;
  }

  const events = await loadSessionEvents(db, session.id);
  const validation = validateDigitSpanEvents(events, schema);
  if (!validation.valid) {
    return undefined;
  }

  return toDigitSpanAttemptSummaries(validation.data.attempts);
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
  const allEffectiveSessions = await loadEffectiveSessions(db, input.studentId, input.trainingKey);

  const hasHistoricalOutsideWindow =
    input.window !== "all" &&
    allEffectiveSessions.some(
      (session) =>
        !isFamilyDateInTrendWindow(session.familyDate, input.window, referenceFamilyDate),
    );

  const windowSessions = allEffectiveSessions.filter((session) =>
    isFamilyDateInTrendWindow(session.familyDate, input.window, referenceFamilyDate),
  );

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
    const metrics = await loadSessionMetricsForTrend(db, session.id);
    const digitSpanAttempts = await loadDigitSpanAttemptSummaries(db, session);
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
  const conditions = [eq(trainingProfileProjection.studentId, studentId)];
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
  const sessions = await tx
    .select()
    .from(trainingSessions)
    .where(
      and(
        eq(trainingSessions.studentId, studentId),
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
    .where(eq(trainingProfileProjection.studentId, studentId));

  let projectionRowsWritten = 0;
  for (const segment of segmentStates.values()) {
    for (const row of segment.metrics.values()) {
      await tx.insert(trainingProfileProjection).values({
        studentId,
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
      SELECT DISTINCT student_id
      FROM training_sessions
      WHERE status = 'completed' AND session_kind = 'effective'
      ORDER BY student_id
    `);

    const studentIds = (studentRows as unknown as { student_id: string }[]).map(
      (row) => row.student_id,
    );
    studentsScanned = studentIds.length;

    for (const studentId of studentIds) {
      const result = await rebuildTrainingProfileProjectionForStudent(tx, studentId, now);
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
        .where(notInArray(trainingProfileProjection.studentId, studentIds));
    }
  });

  return {
    studentsScanned,
    sessionsScanned,
    projectionRowsWritten,
  };
}
