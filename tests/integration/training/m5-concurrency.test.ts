import { config } from "dotenv";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import {
  auditEvents,
  outboxEvents,
  trainingMetrics,
  trainingProfileProjection,
  trainingSessions,
} from "@/db/schema";
import { requireDatabaseUrl } from "@/lib/env";
import * as auditModule from "@/modules/audit/append-audit-event";
import { REACTION_TRAINING_KEY } from "@/modules/training/constants";
import { getMetricDefinitions } from "@/modules/training/protocol";
import {
  appendTrainingEvent,
  startTrainingSession,
  submitTrainingSession,
} from "@/modules/training/session.service";
import { seedStudentUser } from "../../helpers/family-access";
import {
  closeTestDb,
  getTestDb,
  migrateTestDb,
  resetIdentityTables,
  type TestDb,
} from "../../helpers/db";
import {
  assertCompetitionAdvisoryLockContention,
  createSubmitRaceBarrier,
  ensureSubmitRaceWitnessTable,
  signalSubmitRaceArrival,
} from "../../helpers/training-submit-race";
import { completeReactionSession, ensureM5TrainingDefinitions } from "../../helpers/training";

config({ path: ".env.local" });
config({ path: ".env" });

const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);
const REACTION_COMPLETED_METRIC_COUNT = getMetricDefinitions(REACTION_TRAINING_KEY).length;

async function withIndependentConnection<T>(fn: (db: TestDb) => Promise<T>): Promise<T> {
  const client = postgres(requireDatabaseUrl(), { max: 1 });
  const independentDb = drizzle(client, { schema });
  try {
    return await fn(independentDb);
  } finally {
    await client.end({ timeout: 5 });
  }
}

async function prepareReactionSessionForSubmit(
  db: TestDb,
  studentId: string,
  input: { sessionId: string; startIdempotencyKey: string },
) {
  let sequence = 0;
  for (let trialIndex = 0; trialIndex < 5; trialIndex += 1) {
    await appendTrainingEvent(db, {
      studentId,
      sessionId: input.sessionId,
      sequence,
      eventType: "trial.stimulus",
      payload: { trialIndex },
    });
    sequence += 1;
    await new Promise((resolve) => setTimeout(resolve, 150));
    await appendTrainingEvent(db, {
      studentId,
      sessionId: input.sessionId,
      sequence,
      eventType: "trial.response",
      payload: { trialIndex, correct: true, inputMethod: "keyboard" },
    });
    sequence += 1;
  }
}

describe.skipIf(!hasDb)("M5 training concurrency", () => {
  const db = getTestDb();

  beforeAll(async () => {
    process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";
    await migrateTestDb();
    await ensureSubmitRaceWitnessTable(db);
  });

  beforeEach(async () => {
    await resetIdentityTables(db);
    await ensureM5TrainingDefinitions(db);
    await ensureSubmitRaceWitnessTable(db);
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("P1-R10: competition advisory lock contention is observable on the real submit key", async () => {
    const student = await seedStudentUser(db, {
      username: `lock_contention_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
      birthDate: "2015-06-01",
    });

    const started = await startTrainingSession(db, {
      studentId: student.studentId,
      trainingKey: REACTION_TRAINING_KEY,
      idempotencyKey: "lock-contention-start",
    });

    const [sessionRow] = await db
      .select({ familyDate: trainingSessions.familyDate })
      .from(trainingSessions)
      .where(eq(trainingSessions.id, started.sessionId));

    const lockKey = `${student.studentId}:${REACTION_TRAINING_KEY}:${sessionRow!.familyDate}`;
    await assertCompetitionAdvisoryLockContention(lockKey);
  });

  it("P1-R10 / AC-M5-04: concurrent dual-session submit yields one effective and one practice with exact side effects", async () => {
    const student = await seedStudentUser(db, {
      username: `concurrent_dual_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
      birthDate: "2015-06-01",
    });

    const startedA = await startTrainingSession(db, {
      studentId: student.studentId,
      trainingKey: REACTION_TRAINING_KEY,
      idempotencyKey: "concurrent-dual-start-a",
    });
    const startedB = await startTrainingSession(db, {
      studentId: student.studentId,
      trainingKey: REACTION_TRAINING_KEY,
      idempotencyKey: "concurrent-dual-start-b",
    });

    await prepareReactionSessionForSubmit(db, student.studentId, {
      sessionId: startedA.sessionId,
      startIdempotencyKey: "concurrent-dual-start-a",
    });
    await prepareReactionSessionForSubmit(db, student.studentId, {
      sessionId: startedB.sessionId,
      startIdempotencyKey: "concurrent-dual-start-b",
    });

    const barrier = createSubmitRaceBarrier(2);

    const writers = Promise.all([
      withIndependentConnection(async (conn) => {
        await signalSubmitRaceArrival(conn, 1, barrier);
        return submitTrainingSession(conn, {
          studentId: student.studentId,
          sessionId: startedA.sessionId,
          idempotencyKey: "concurrent-dual-submit-a",
        });
      }),
      withIndependentConnection(async (conn) => {
        await signalSubmitRaceArrival(conn, 2, barrier);
        return submitTrainingSession(conn, {
          studentId: student.studentId,
          sessionId: startedB.sessionId,
          idempotencyKey: "concurrent-dual-submit-b",
        });
      }),
    ]);

    await barrier.waitAllArmed();
    barrier.release();
    const results = await writers;

    expect(results.every((result) => result.status === "completed")).toBe(true);
    const kinds = results.map((result) => result.sessionKind).sort();
    expect(kinds).toEqual(["effective", "practice"]);

    const effectiveRows = await db
      .select()
      .from(trainingSessions)
      .where(
        and(
          eq(trainingSessions.studentId, student.studentId),
          eq(trainingSessions.trainingKey, REACTION_TRAINING_KEY),
          eq(trainingSessions.sessionKind, "effective"),
          eq(trainingSessions.status, "completed"),
        ),
      );
    expect(effectiveRows).toHaveLength(1);

    const metricRows = await db
      .select()
      .from(trainingMetrics)
      .where(inArray(trainingMetrics.sessionId, [startedA.sessionId, startedB.sessionId]));
    expect(metricRows).toHaveLength(REACTION_COMPLETED_METRIC_COUNT * 2);

    const metricsBySession = new Map<string, number>();
    for (const row of metricRows) {
      metricsBySession.set(row.sessionId, (metricsBySession.get(row.sessionId) ?? 0) + 1);
    }
    expect(metricsBySession.get(startedA.sessionId)).toBe(REACTION_COMPLETED_METRIC_COUNT);
    expect(metricsBySession.get(startedB.sessionId)).toBe(REACTION_COMPLETED_METRIC_COUNT);

    const completeAudits = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "training_session.completed"));
    expect(completeAudits).toHaveLength(2);

    const outboxRows = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.eventType, "training_session.completed"));
    expect(outboxRows).toHaveLength(2);
    expect(new Set(outboxRows.map((row) => row.dedupeKey)).size).toBe(2);
  });

  it("P1-R10 / AC-M5-04: concurrent same-session submit with same idempotency key deduplicates side effects", async () => {
    const student = await seedStudentUser(db, {
      username: `concurrent_idem_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
      birthDate: "2015-06-01",
    });

    const started = await startTrainingSession(db, {
      studentId: student.studentId,
      trainingKey: REACTION_TRAINING_KEY,
      idempotencyKey: "concurrent-idem-start",
    });

    await prepareReactionSessionForSubmit(db, student.studentId, {
      sessionId: started.sessionId,
      startIdempotencyKey: "concurrent-idem-start",
    });

    const barrier = createSubmitRaceBarrier(2);

    const writers = Promise.all([
      withIndependentConnection(async (conn) => {
        await signalSubmitRaceArrival(conn, 1, barrier);
        return submitTrainingSession(conn, {
          studentId: student.studentId,
          sessionId: started.sessionId,
          idempotencyKey: "concurrent-idem-submit",
        });
      }),
      withIndependentConnection(async (conn) => {
        await signalSubmitRaceArrival(conn, 2, barrier);
        return submitTrainingSession(conn, {
          studentId: student.studentId,
          sessionId: started.sessionId,
          idempotencyKey: "concurrent-idem-submit",
        });
      }),
    ]);

    await barrier.waitAllArmed();
    barrier.release();
    const results = await writers;

    expect(results).toHaveLength(2);
    expect(results.filter((result) => result.idempotentReplay)).toHaveLength(1);
    expect(results[0]!.sessionId).toBe(results[1]!.sessionId);

    const metricRows = await db
      .select()
      .from(trainingMetrics)
      .where(eq(trainingMetrics.sessionId, started.sessionId));
    expect(metricRows).toHaveLength(REACTION_COMPLETED_METRIC_COUNT);

    const completeAudits = await db
      .select()
      .from(auditEvents)
      .where(
        eq(
          auditEvents.idempotencyKey,
          `audit:training-complete:${student.studentId}:concurrent-idem-submit`,
        ),
      );
    expect(completeAudits).toHaveLength(1);

    const outboxRows = await db
      .select()
      .from(outboxEvents)
      .where(
        eq(
          outboxEvents.dedupeKey,
          `outbox:training-complete:${student.studentId}:concurrent-idem-submit`,
        ),
      );
    expect(outboxRows).toHaveLength(1);
  });

  it("P1-R05: audit failure rolls back invalid session state and submit key", async () => {
    const student = await seedStudentUser(db, {
      username: `invalid_rollback_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
      birthDate: "2015-06-01",
    });

    const started = await startTrainingSession(db, {
      studentId: student.studentId,
      trainingKey: REACTION_TRAINING_KEY,
      idempotencyKey: "invalid-rollback-start",
    });

    await appendTrainingEvent(db, {
      studentId: student.studentId,
      sessionId: started.sessionId,
      sequence: 0,
      eventType: "trial.stimulus",
      payload: { trialIndex: 0 },
    });

    const auditSpy = vi
      .spyOn(auditModule, "appendAuditEvent")
      .mockRejectedValueOnce(new Error("audit write failed"));

    await expect(
      submitTrainingSession(db, {
        studentId: student.studentId,
        sessionId: started.sessionId,
        idempotencyKey: "invalid-rollback-submit",
      }),
    ).rejects.toThrow("audit write failed");

    auditSpy.mockRestore();

    const [sessionRow] = await db
      .select()
      .from(trainingSessions)
      .where(eq(trainingSessions.id, started.sessionId));
    expect(sessionRow?.status).toBe("active");
    expect(sessionRow?.submitIdempotencyKey).toBeNull();

    const invalidAudits = await db
      .select()
      .from(auditEvents)
      .where(
        eq(
          auditEvents.idempotencyKey,
          `audit:training-invalid:${student.studentId}:invalid-rollback-submit`,
        ),
      );
    expect(invalidAudits).toHaveLength(0);
  });

  it("P1-R02: practice session does not overwrite effective projection", async () => {
    const student = await seedStudentUser(db, {
      username: `practice_proj_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
      birthDate: "2015-06-01",
    });

    const first = await completeReactionSession(db, student.studentId, {
      startIdempotencyKey: "practice-proj-start-a",
      submitIdempotencyKey: "practice-proj-submit-a",
      reactionMs: 500,
    });
    expect(first.submitted.sessionKind).toBe("effective");

    const second = await completeReactionSession(db, student.studentId, {
      startIdempotencyKey: "practice-proj-start-b",
      submitIdempotencyKey: "practice-proj-submit-b",
      reactionMs: 200,
    });
    expect(second.submitted.sessionKind).toBe("practice");

    const projectionRows = await db
      .select()
      .from(trainingProfileProjection)
      .where(
        and(
          eq(trainingProfileProjection.studentId, student.studentId),
          eq(trainingProfileProjection.trainingKey, REACTION_TRAINING_KEY),
          eq(trainingProfileProjection.metricKey, "median_reaction_ms"),
        ),
      );
    expect(projectionRows).toHaveLength(1);
    expect(projectionRows[0]!.lastSourceSessionId).toBe(first.submitted.sessionId);
    expect(Number(projectionRows[0]!.bestValue)).toBeGreaterThan(400);
    expect(Number(projectionRows[0]!.lastValue)).toBeGreaterThan(400);
  });
});
