import { sql } from "drizzle-orm";
import { config } from "dotenv";
import { and, eq, inArray } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  auditEvents,
  outboxEvents,
  trainingDefinitions,
  trainingMetrics,
  trainingProfileProjection,
  trainingSessions,
} from "@/db/schema";
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
import { requireDatabaseUrl } from "@/lib/env";
import {
  buildFullRebuildProjectionLockKey,
  buildSubmitCompetitionLockKey,
  FIXED_NEGATIVE_HASH_LOCK_KEY,
  FIXED_POSITIVE_HASH_LOCK_KEY,
  INJECTED_GATE_CLOSE_FAILURE_MESSAGE,
  INJECTED_GATE_UNLOCK_FAILURE_MESSAGE,
  INJECTED_MONITOR_CLOSE_FAILURE_MESSAGE,
  INJECTED_RUNNER_CLIENT_CLOSE_FAILURE_MESSAGE,
  INJECTED_RUNNER_SETTLE_FAILURE_MESSAGE,
  isPostgresBackendActive,
  runConcurrentSubmitsWithContentionEvidence,
  type ConcurrentSubmitRaceOptions,
  type RaceCleanupTrace,
} from "../../helpers/training-submit-race";
import { completeReactionSession, ensureM5TrainingDefinitions } from "../../helpers/training";

config({ path: ".env.local" });
config({ path: ".env" });

const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);
const REACTION_COMPLETED_METRIC_COUNT = getMetricDefinitions(REACTION_TRAINING_KEY).length;
const R19_OBSERVATION_TIMEOUT_MS = 750;
const R19_RUNNER_SETTLE_MS = 1500;
const R19_HELPER_BOUND_MS = R19_OBSERVATION_TIMEOUT_MS + R19_RUNNER_SETTLE_MS + 1000;

async function acquireSubmitStyleAdvisoryLock(db: TestDb, lockKey: string): Promise<string> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);
  });
  return lockKey;
}

/** Hold duration that keeps post-unlock holding+waiting observable without blowing R19 bounds. */
const R32_CLIENT_CLOSE_HOLD_MS = 250;

async function holdSubmitStyleAdvisoryLockForObservation(
  db: TestDb,
  lockKey: string,
  holdMs = 2000,
): Promise<string> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);
    await new Promise((resolve) => setTimeout(resolve, holdMs));
    return lockKey;
  });
}

async function countAdvisoryLocksForKey(monitor: postgres.Sql, lockKey: string): Promise<number> {
  const rows = await monitor<{ count: number }[]>`
    SELECT COUNT(*)::int AS count
    FROM pg_locks l
    WHERE l.locktype = 'advisory'
      AND l.classid = ((hashtext(${lockKey})::bigint >> 32) & 4294967295)::oid
      AND l.objid = (hashtext(${lockKey})::bigint & 4294967295)::oid
  `;
  return rows[0]!.count;
}

async function assertBoundedRaceOutcome(
  runRace: () => Promise<unknown>,
  options: {
    lockKeys: string[];
    assertOutcome: (outcome: {
      reason: unknown;
      elapsedMs: number;
      rejected: boolean;
    }) => void | Promise<void>;
  },
): Promise<void> {
  const monitor = postgres(requireDatabaseUrl(), { max: 1 });

  try {
    const startedAt = Date.now();
    let reason: unknown;
    let rejected = false;
    try {
      await runRace();
    } catch (error) {
      rejected = true;
      reason = error;
    }
    await options.assertOutcome({
      reason,
      elapsedMs: Date.now() - startedAt,
      rejected,
    });
    for (const lockKey of options.lockKeys) {
      expect(await countAdvisoryLocksForKey(monitor, lockKey)).toBe(0);
    }
  } finally {
    await monitor.end({ timeout: 5 }).catch(() => undefined);
  }
}

function expectBoundedElapsed(elapsedMs: number): void {
  expect(elapsedMs).toBeLessThan(R19_HELPER_BOUND_MS);
}

function expectThrownMessage(reason: unknown, expected: RegExp | string): void {
  expect(reason).toBeInstanceOf(Error);
  if (typeof expected === "string") {
    expect((reason as Error).message).toBe(expected);
  } else {
    expect((reason as Error).message).toMatch(expected);
  }
}

function collectErrorMessages(reason: unknown): string[] {
  if (reason instanceof AggregateError) {
    return reason.errors.flatMap((error) => collectErrorMessages(error));
  }
  if (reason instanceof Error) {
    return [reason.message];
  }
  if (reason === undefined) {
    return ["undefined"];
  }
  return [String(reason)];
}

/**
 * runner_client_close_throw must always preserve the injected close failure.
 * When the race primary also fails (e.g. missed holding+waiting window), the helper
 * wraps primary + cleanup into AggregateError — classify both sides explicitly.
 */
function expectInjectedRunnerClientCloseRecorded(reason: unknown): void {
  expect(collectErrorMessages(reason)).toContain(INJECTED_RUNNER_CLIENT_CLOSE_FAILURE_MESSAGE);

  if (reason instanceof AggregateError) {
    expect(reason.message).toBe("Concurrent submit race failed with cleanup error");
    expect(reason.errors.length).toBeGreaterThanOrEqual(2);
    expectThrownMessage(
      reason.errors[0],
      /Timed out waiting for (all submit backends waiting on gated advisory lock|one submit backend holding and another waiting on gated advisory lock)/,
    );
    expect(collectErrorMessages(reason.errors[1])).toContain(
      INJECTED_RUNNER_CLIENT_CLOSE_FAILURE_MESSAGE,
    );
    return;
  }

  expectThrownMessage(reason, INJECTED_RUNNER_CLIENT_CLOSE_FAILURE_MESSAGE);
}

function boundedRaceOptions(
  overrides: Partial<ConcurrentSubmitRaceOptions> = {},
): ConcurrentSubmitRaceOptions {
  return {
    observationTimeoutMs: R19_OBSERVATION_TIMEOUT_MS,
    runnerSettleMs: R19_RUNNER_SETTLE_MS,
    ...overrides,
  };
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
  });

  beforeEach(async () => {
    await resetIdentityTables(db);
    await ensureM5TrainingDefinitions(db);
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("P1-R13 / P1-R10 / AC-M5-04: concurrent dual-session submit yields one effective and one practice with exact side effects", async () => {
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

    // Gate the first lock in production submit order (full-rebuild), not the
    // per-student competition lock — the global exclusive lock serializes runners
    // before they can both wait on competition.
    const results = await runConcurrentSubmitsWithContentionEvidence(
      buildFullRebuildProjectionLockKey(),
      [
        (conn) =>
          submitTrainingSession(conn, {
            studentId: student.studentId,
            sessionId: startedA.sessionId,
            idempotencyKey: "concurrent-dual-submit-a",
          }),
        (conn) =>
          submitTrainingSession(conn, {
            studentId: student.studentId,
            sessionId: startedB.sessionId,
            idempotencyKey: "concurrent-dual-submit-b",
          }),
      ],
    );

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

  it("P1-R13 / P1-R10 / AC-M5-04: concurrent same-session submit with same idempotency key deduplicates side effects", async () => {
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

    const results = await runConcurrentSubmitsWithContentionEvidence(
      buildFullRebuildProjectionLockKey(),
      [
        (conn) =>
          submitTrainingSession(conn, {
            studentId: student.studentId,
            sessionId: started.sessionId,
            idempotencyKey: "concurrent-idem-submit",
          }),
        (conn) =>
          submitTrainingSession(conn, {
            studentId: student.studentId,
            sessionId: started.sessionId,
            idempotencyKey: "concurrent-idem-submit",
          }),
      ],
    );

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

  it("P1-R20: Drizzle schema declares training_definitions_active_domain check", () => {
    const tableConfig = getTableConfig(trainingDefinitions);
    const domainCheck = tableConfig.checks.find(
      (constraint) => constraint.name === "training_definitions_active_domain",
    );
    expect(domainCheck).toBeDefined();
  });

  it("P1-R21: contention helper reuses production two-level submit lock key builders", () => {
    const studentId = "00000000-0000-0000-0000-000000000123";
    const familyDate = "2025-08-30";
    expect(buildFullRebuildProjectionLockKey()).toBe("training:profile-projection:full-rebuild");
    expect(buildSubmitCompetitionLockKey(studentId, REACTION_TRAINING_KEY, familyDate)).toBe(
      `${studentId}:${REACTION_TRAINING_KEY}:${familyDate}`,
    );
  });

  it("P1-R18: locates advisory lock backend for fixed positive hash key", async () => {
    const results = await runConcurrentSubmitsWithContentionEvidence(FIXED_POSITIVE_HASH_LOCK_KEY, [
      (db) => holdSubmitStyleAdvisoryLockForObservation(db, FIXED_POSITIVE_HASH_LOCK_KEY),
      (db) => holdSubmitStyleAdvisoryLockForObservation(db, FIXED_POSITIVE_HASH_LOCK_KEY),
    ]);

    expect(results).toEqual([FIXED_POSITIVE_HASH_LOCK_KEY, FIXED_POSITIVE_HASH_LOCK_KEY]);
  });

  it("P1-R18: locates advisory lock backend for fixed negative hash key", async () => {
    const results = await runConcurrentSubmitsWithContentionEvidence(FIXED_NEGATIVE_HASH_LOCK_KEY, [
      (db) => holdSubmitStyleAdvisoryLockForObservation(db, FIXED_NEGATIVE_HASH_LOCK_KEY),
      (db) => holdSubmitStyleAdvisoryLockForObservation(db, FIXED_NEGATIVE_HASH_LOCK_KEY),
    ]);

    expect(results).toEqual([FIXED_NEGATIVE_HASH_LOCK_KEY, FIXED_NEGATIVE_HASH_LOCK_KEY]);
  });

  it("P1-R19: observation failure releases gate and finishes within bounded time", async () => {
    const realLockKey = FIXED_POSITIVE_HASH_LOCK_KEY;
    const mismatchLockKey = "m5-observation-mismatch-lock-key";

    await assertBoundedRaceOutcome(
      () =>
        runConcurrentSubmitsWithContentionEvidence(
          mismatchLockKey,
          [
            (db) => acquireSubmitStyleAdvisoryLock(db, realLockKey),
            (db) => acquireSubmitStyleAdvisoryLock(db, realLockKey),
          ],
          boundedRaceOptions(),
        ),
      {
        lockKeys: [mismatchLockKey, realLockKey],
        assertOutcome: ({ reason, elapsedMs, rejected }) => {
          expect(rejected).toBe(true);
          expectThrownMessage(reason, /Timed out waiting for all submit backends waiting/);
          expectBoundedElapsed(elapsedMs);
        },
      },
    );
  });

  it("P1-R19: runner early failure still releases gate within bounded time", async () => {
    const lockKey = FIXED_NEGATIVE_HASH_LOCK_KEY;

    await assertBoundedRaceOutcome(
      () =>
        runConcurrentSubmitsWithContentionEvidence(
          lockKey,
          [
            async () => {
              throw new Error("runner failed before submit");
            },
            (db) => acquireSubmitStyleAdvisoryLock(db, lockKey),
          ],
          boundedRaceOptions(),
        ),
      {
        lockKeys: [lockKey],
        assertOutcome: ({ reason, elapsedMs, rejected }) => {
          expect(rejected).toBe(true);
          expect(reason).toBeInstanceOf(Error);
          expect((reason as Error).message).toMatch(
            /runner failed before submit|Timed out waiting for all submit backends waiting/,
          );
          expectBoundedElapsed(elapsedMs);
        },
      },
    );
  });

  it("P1-R26: forced gate unlock throw after observation rejects with unlock failure", async () => {
    const lockKey = FIXED_POSITIVE_HASH_LOCK_KEY;

    await assertBoundedRaceOutcome(
      () =>
        runConcurrentSubmitsWithContentionEvidence(
          lockKey,
          [
            (db) => acquireSubmitStyleAdvisoryLock(db, lockKey),
            (db) => acquireSubmitStyleAdvisoryLock(db, lockKey),
          ],
          boundedRaceOptions({ injectGateUnlockFailure: "throw" }),
        ),
      {
        lockKeys: [lockKey],
        assertOutcome: ({ reason, elapsedMs, rejected }) => {
          expect(rejected).toBe(true);
          expectThrownMessage(reason, INJECTED_GATE_UNLOCK_FAILURE_MESSAGE);
          expectBoundedElapsed(elapsedMs);
        },
      },
    );
  });

  it("P1-R26: forced gate unlock false after observation rejects with unlock failure", async () => {
    const lockKey = FIXED_NEGATIVE_HASH_LOCK_KEY;

    await assertBoundedRaceOutcome(
      () =>
        runConcurrentSubmitsWithContentionEvidence(
          lockKey,
          [
            (db) => acquireSubmitStyleAdvisoryLock(db, lockKey),
            (db) => acquireSubmitStyleAdvisoryLock(db, lockKey),
          ],
          boundedRaceOptions({ injectGateUnlockFailure: "return_false" }),
        ),
      {
        lockKeys: [lockKey],
        assertOutcome: ({ reason, elapsedMs, rejected }) => {
          expect(rejected).toBe(true);
          expectThrownMessage(reason, /Failed to release gated advisory lock/);
          expectBoundedElapsed(elapsedMs);
        },
      },
    );
  });

  it("P1-R31 / P1-R27: injected gate close failure still terminates gate connection", async () => {
    const lockKey = FIXED_POSITIVE_HASH_LOCK_KEY;
    let cleanupTrace: RaceCleanupTrace | undefined;

    await assertBoundedRaceOutcome(
      () =>
        runConcurrentSubmitsWithContentionEvidence(
          lockKey,
          [
            (db) => acquireSubmitStyleAdvisoryLock(db, lockKey),
            (db) => acquireSubmitStyleAdvisoryLock(db, lockKey),
          ],
          boundedRaceOptions({
            injectGateUnlockFailure: "throw",
            injectGateCloseFailure: true,
            onCleanupTrace: (trace) => {
              cleanupTrace = trace;
            },
          }),
        ),
      {
        lockKeys: [lockKey],
        assertOutcome: async ({ reason, elapsedMs, rejected }) => {
          expect(rejected).toBe(true);
          expect(reason).toBeInstanceOf(AggregateError);
          const aggregate = reason as AggregateError;
          expect(aggregate.message).toMatch(/cleanup error/i);
          expect(aggregate.errors).toHaveLength(2);
          expectThrownMessage(aggregate.errors[0], INJECTED_GATE_UNLOCK_FAILURE_MESSAGE);
          expectThrownMessage(aggregate.errors[1], INJECTED_GATE_CLOSE_FAILURE_MESSAGE);
          expect(cleanupTrace).toBeDefined();
          expect(cleanupTrace!.firstInjectedGateCloseAttempted).toBe(true);
          expect(cleanupTrace!.firstInjectedGateCloseFailed).toBe(true);
          expect(cleanupTrace!.finalGateCloseAttempted).toBe(true);
          expect(cleanupTrace!.finalGateCloseSucceeded).toBe(true);
          const monitor = postgres(requireDatabaseUrl(), { max: 1 });
          try {
            expect(await isPostgresBackendActive(monitor, cleanupTrace!.gateBackendPid)).toBe(
              false,
            );
          } finally {
            await monitor.end({ timeout: 5 }).catch(() => undefined);
          }
          expectBoundedElapsed(elapsedMs);
        },
      },
    );
  });

  it("P1-R28: throw undefined after observation still rejects instead of returning undefined", async () => {
    const lockKey = FIXED_POSITIVE_HASH_LOCK_KEY;

    await assertBoundedRaceOutcome(
      () =>
        runConcurrentSubmitsWithContentionEvidence(
          lockKey,
          [
            (db) => acquireSubmitStyleAdvisoryLock(db, lockKey),
            (db) => acquireSubmitStyleAdvisoryLock(db, lockKey),
          ],
          boundedRaceOptions({ injectGateUnlockFailure: "throw_undefined" }),
        ),
      {
        lockKeys: [lockKey],
        assertOutcome: ({ reason, elapsedMs, rejected }) => {
          expect(rejected).toBe(true);
          expect(reason).toBeUndefined();
          expectBoundedElapsed(elapsedMs);
        },
      },
    );
  });

  it("P1-R32: runner settle cleanup failure is recorded without losing remaining cleanup", async () => {
    const lockKey = FIXED_POSITIVE_HASH_LOCK_KEY;

    await assertBoundedRaceOutcome(
      () =>
        runConcurrentSubmitsWithContentionEvidence(
          lockKey,
          [
            (db) => acquireSubmitStyleAdvisoryLock(db, lockKey),
            (db) => acquireSubmitStyleAdvisoryLock(db, lockKey),
          ],
          boundedRaceOptions({
            injectGateUnlockFailure: "throw",
            injectCleanupFailure: "runner_settle_timeout",
          }),
        ),
      {
        lockKeys: [lockKey],
        assertOutcome: ({ reason, elapsedMs, rejected }) => {
          expect(rejected).toBe(true);
          expect(reason).toBeInstanceOf(AggregateError);
          const aggregate = reason as AggregateError;
          expect(aggregate.errors).toHaveLength(2);
          expectThrownMessage(aggregate.errors[0], INJECTED_GATE_UNLOCK_FAILURE_MESSAGE);
          expectThrownMessage(aggregate.errors[1], INJECTED_RUNNER_SETTLE_FAILURE_MESSAGE);
          expectBoundedElapsed(elapsedMs);
        },
      },
    );
  });

  it("P1-R32: monitor close cleanup failure is recorded in cleanup aggregate", async () => {
    const lockKey = FIXED_NEGATIVE_HASH_LOCK_KEY;

    await assertBoundedRaceOutcome(
      () =>
        runConcurrentSubmitsWithContentionEvidence(
          lockKey,
          [
            (db) => acquireSubmitStyleAdvisoryLock(db, lockKey),
            (db) => acquireSubmitStyleAdvisoryLock(db, lockKey),
          ],
          boundedRaceOptions({
            injectGateUnlockFailure: "throw",
            injectCleanupFailure: "monitor_close_throw",
          }),
        ),
      {
        lockKeys: [lockKey],
        assertOutcome: ({ reason, elapsedMs, rejected }) => {
          expect(rejected).toBe(true);
          expect(reason).toBeInstanceOf(AggregateError);
          const aggregate = reason as AggregateError;
          expect(aggregate.errors.length).toBeGreaterThanOrEqual(2);
          expectThrownMessage(aggregate.errors.at(-1), INJECTED_MONITOR_CLOSE_FAILURE_MESSAGE);
          expectBoundedElapsed(elapsedMs);
        },
      },
    );
  });

  it("P1-R32: monitor close cleanup throw undefined is propagated", async () => {
    const realLockKey = FIXED_POSITIVE_HASH_LOCK_KEY;
    const mismatchLockKey = "m5-cleanup-throw-undefined-lock-key";

    await assertBoundedRaceOutcome(
      () =>
        runConcurrentSubmitsWithContentionEvidence(
          mismatchLockKey,
          [
            (db) => acquireSubmitStyleAdvisoryLock(db, realLockKey),
            (db) => acquireSubmitStyleAdvisoryLock(db, realLockKey),
          ],
          boundedRaceOptions({ injectCleanupFailure: "cleanup_throw_undefined" }),
        ),
      {
        lockKeys: [mismatchLockKey, realLockKey],
        assertOutcome: ({ reason, elapsedMs, rejected }) => {
          expect(rejected).toBe(true);
          expect(reason).toBeInstanceOf(AggregateError);
          expect((reason as AggregateError).errors.some((error) => error === undefined)).toBe(true);
          expectBoundedElapsed(elapsedMs);
        },
      },
    );
  });

  it("P1-R32: runner client close failure is recorded in cleanup aggregate", async () => {
    const lockKey = FIXED_POSITIVE_HASH_LOCK_KEY;

    await assertBoundedRaceOutcome(
      () =>
        runConcurrentSubmitsWithContentionEvidence(
          lockKey,
          // Instant-release acquires can finish before holding+waiting is observed,
          // producing a flaky primary timeout wrapped with cleanup. Brief hold keeps
          // the post-unlock contention window observable within R19 bounds.
          [
            (db) =>
              holdSubmitStyleAdvisoryLockForObservation(db, lockKey, R32_CLIENT_CLOSE_HOLD_MS),
            (db) =>
              holdSubmitStyleAdvisoryLockForObservation(db, lockKey, R32_CLIENT_CLOSE_HOLD_MS),
          ],
          boundedRaceOptions({ injectCleanupFailure: "runner_client_close_throw" }),
        ),
      {
        lockKeys: [lockKey],
        assertOutcome: ({ reason, elapsedMs, rejected }) => {
          expect(rejected).toBe(true);
          expectInjectedRunnerClientCloseRecorded(reason);
          expectBoundedElapsed(elapsedMs);
        },
      },
    );
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
