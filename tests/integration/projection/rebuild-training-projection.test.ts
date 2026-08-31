import { config } from "dotenv";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";

import { trainingProfileProjection, trainingSessions } from "@/db/schema";
import { REACTION_TRAINING_KEY } from "@/modules/training/constants";
import {
  appendTrainingEvent,
  startTrainingSession,
  submitTrainingSession,
} from "@/modules/training/session.service";
import {
  loadTrainingProfileProjectionRows,
  projectionRowsEquivalent,
  rebuildTrainingProfileProjection,
  rebuildTrainingProfileProjectionForStudent,
} from "@/modules/training/trends.service";
import { seedStudentUser } from "../../helpers/family-access";
import { completeReactionSession, ensureM5TrainingDefinitions } from "../../helpers/training";
import { closeTestDb, getTestDb, migrateTestDb, resetIdentityTables } from "../../helpers/db";

config({ path: ".env.local" });
config({ path: ".env" });

const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);
const P2_R04_RACE_TIMEOUT_MS = 15000;

function createGate<T>() {
  let resolve!: (value: T) => void;
  const opened = new Promise<T>((res) => {
    resolve = res;
  });
  let released = false;
  return {
    opened,
    open(value: T) {
      if (released) {
        return;
      }
      released = true;
      resolve(value);
    },
  };
}

async function startReactionSessionReadyToSubmit(
  db: ReturnType<typeof getTestDb>,
  studentId: string,
) {
  const started = await startTrainingSession(db, {
    studentId,
    trainingKey: REACTION_TRAINING_KEY,
    idempotencyKey: `p2-r04-start-${crypto.randomUUID()}`,
  });

  let sequence = 0;
  for (let trialIndex = 0; trialIndex < 5; trialIndex += 1) {
    await appendTrainingEvent(db, {
      studentId,
      sessionId: started.sessionId,
      sequence,
      eventType: "trial.stimulus",
      payload: { trialIndex, stimulusId: `s-${trialIndex}` },
    });
    sequence += 1;

    await appendTrainingEvent(db, {
      studentId,
      sessionId: started.sessionId,
      sequence,
      eventType: "trial.response",
      payload: {
        trialIndex,
        correct: true,
        inputMethod: "keyboard",
      },
    });
    sequence += 1;
  }

  return started;
}

describe.skipIf(!hasDb)("M5 training projection rebuild", () => {
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

  it("AC-M5-06: repeat rebuild is idempotent", async () => {
    const student = await seedStudentUser(db, {
      username: `rebuild_idem_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
      birthDate: "2015-06-01",
    });

    await completeReactionSession(db, student.studentId, {
      startIdempotencyKey: "rebuild-idem-1",
      submitIdempotencyKey: "rebuild-idem-1-submit",
    });
    await completeReactionSession(db, student.studentId, {
      startIdempotencyKey: "rebuild-idem-2",
      submitIdempotencyKey: "rebuild-idem-2-submit",
    });

    const baseline = await loadTrainingProfileProjectionRows(db, student.studentId);

    await db.transaction(async (tx) => {
      await rebuildTrainingProfileProjectionForStudent(tx, student.studentId);
    });
    const firstRebuild = await loadTrainingProfileProjectionRows(db, student.studentId);

    await db.transaction(async (tx) => {
      await rebuildTrainingProfileProjectionForStudent(tx, student.studentId);
    });
    const secondRebuild = await loadTrainingProfileProjectionRows(db, student.studentId);

    expect(
      projectionRowsEquivalent(
        baseline.map((row) => ({
          trainingKey: row.trainingKey,
          definitionVersion: row.definitionVersion,
          ageBand: row.ageBand,
          metricKey: row.metricKey,
          bestValue: row.bestValue,
          lastValue: row.lastValue,
          lastSourceSessionId: row.lastSourceSessionId,
        })),
        firstRebuild.map((row) => ({
          trainingKey: row.trainingKey,
          definitionVersion: row.definitionVersion,
          ageBand: row.ageBand,
          metricKey: row.metricKey,
          bestValue: row.bestValue,
          lastValue: row.lastValue,
          lastSourceSessionId: row.lastSourceSessionId,
        })),
      ),
    ).toBe(true);
    expect(
      projectionRowsEquivalent(
        firstRebuild.map((row) => ({
          trainingKey: row.trainingKey,
          definitionVersion: row.definitionVersion,
          ageBand: row.ageBand,
          metricKey: row.metricKey,
          bestValue: row.bestValue,
          lastValue: row.lastValue,
          lastSourceSessionId: row.lastSourceSessionId,
        })),
        secondRebuild.map((row) => ({
          trainingKey: row.trainingKey,
          definitionVersion: row.definitionVersion,
          ageBand: row.ageBand,
          metricKey: row.metricKey,
          bestValue: row.bestValue,
          lastValue: row.lastValue,
          lastSourceSessionId: row.lastSourceSessionId,
        })),
      ),
    ).toBe(true);
  });

  it("P2-R01: full rebuild removes stale projection for student without authoritative sessions", async () => {
    const studentA = await seedStudentUser(db, {
      username: `rebuild_orphan_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
      birthDate: "2015-06-01",
    });
    const studentB = await seedStudentUser(db, {
      username: `rebuild_active_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
      birthDate: "2015-06-01",
    });

    await db.insert(trainingProfileProjection).values({
      studentId: studentA.studentId,
      trainingKey: REACTION_TRAINING_KEY,
      definitionVersion: 1,
      ageBand: "9-12",
      metricKey: "accuracy",
      bestValue: "0.500000",
      lastValue: "0.500000",
      windowSummary: { lastFamilyDate: "2026-01-01" },
    });

    await completeReactionSession(db, studentB.studentId, {
      startIdempotencyKey: "rebuild-dual-b-start",
      submitIdempotencyKey: "rebuild-dual-b-submit",
    });

    await rebuildTrainingProfileProjection(db);

    const rowsA = await loadTrainingProfileProjectionRows(db, studentA.studentId);
    const rowsB = await loadTrainingProfileProjectionRows(db, studentB.studentId);

    expect(rowsA).toHaveLength(0);
    expect(rowsB.some((row) => row.metricKey === "accuracy")).toBe(true);
    expect(rowsB.every((row) => row.trainingKey === REACTION_TRAINING_KEY)).toBe(true);
  });

  it("P2-R01: full rebuild clears all projections when no authoritative sessions exist", async () => {
    const student = await seedStudentUser(db, {
      username: `rebuild_empty_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
      birthDate: "2015-06-01",
    });

    await db.insert(trainingProfileProjection).values({
      studentId: student.studentId,
      trainingKey: REACTION_TRAINING_KEY,
      definitionVersion: 1,
      ageBand: "9-12",
      metricKey: "accuracy",
      bestValue: "1.000000",
      lastValue: "1.000000",
    });

    await rebuildTrainingProfileProjection(db);

    const rows = await loadTrainingProfileProjectionRows(db, student.studentId);
    expect(rows).toHaveLength(0);
  });

  it("AC-M5-06: rebuild removes stale projection rows for inactive training keys", async () => {
    const student = await seedStudentUser(db, {
      username: `rebuild_stale_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
      birthDate: "2015-06-01",
    });

    await completeReactionSession(db, student.studentId, {
      startIdempotencyKey: "rebuild-stale-start",
      submitIdempotencyKey: "rebuild-stale-submit",
    });

    await db.insert(trainingProfileProjection).values({
      studentId: student.studentId,
      trainingKey: "legacy_training",
      definitionVersion: 1,
      ageBand: "9-12",
      metricKey: "accuracy",
      bestValue: "1.000000",
      lastValue: "1.000000",
    });

    await db.transaction(async (tx) => {
      await rebuildTrainingProfileProjectionForStudent(tx, student.studentId);
    });

    const rows = await loadTrainingProfileProjectionRows(db, student.studentId);
    expect(rows.every((row) => row.trainingKey === REACTION_TRAINING_KEY)).toBe(true);
    expect(rows.some((row) => row.metricKey === "accuracy")).toBe(true);
  });

  it("P2-R04: full rebuild orphan cleanup serializes with first effective submit", async () => {
    const studentB = await seedStudentUser(db, {
      username: `rebuild_r04_b_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
      birthDate: "2015-06-01",
    });
    const studentC = await seedStudentUser(db, {
      username: `rebuild_r04_c_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
      birthDate: "2015-06-01",
    });

    await completeReactionSession(db, studentB.studentId, {
      startIdempotencyKey: "p2-r04-b-start",
      submitIdempotencyKey: "p2-r04-b-submit",
    });

    const readySession = await startReactionSessionReadyToSubmit(db, studentC.studentId);
    const releaseOrphanCleanup = createGate<void>();
    const submitStarted = createGate<void>();

    const rebuildPromise = rebuildTrainingProfileProjection(db, {
      testHooks: {
        beforeOrphanCleanup: async () => {
          submitStarted.open(undefined);
          await Promise.race([
            releaseOrphanCleanup.opened,
            new Promise<never>((_, reject) => {
              setTimeout(
                () => reject(new Error("P2-R04 orphan cleanup gate timed out")),
                P2_R04_RACE_TIMEOUT_MS,
              );
            }),
          ]);
        },
      },
    });

    const submitPromise = submitStarted.opened.then(() =>
      submitTrainingSession(db, {
        studentId: studentC.studentId,
        sessionId: readySession.sessionId,
        idempotencyKey: `p2-r04-c-submit-${crypto.randomUUID()}`,
      }),
    );

    await submitStarted.opened;
    await new Promise((resolve) => setTimeout(resolve, 100));
    releaseOrphanCleanup.open(undefined);

    const [rebuildResult, submitResult] = await Promise.race([
      Promise.all([rebuildPromise, submitPromise]),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("P2-R04 race timed out")), P2_R04_RACE_TIMEOUT_MS);
      }),
    ]);

    expect(rebuildResult.studentsScanned).toBe(1);
    expect(submitResult.sessionKind).toBe("effective");
    expect(submitResult.status).toBe("completed");

    const effectiveSessions = await db
      .select()
      .from(trainingSessions)
      .where(
        and(
          eq(trainingSessions.studentId, studentC.studentId),
          eq(trainingSessions.status, "completed"),
          eq(trainingSessions.sessionKind, "effective"),
        ),
      );
    expect(effectiveSessions).toHaveLength(1);

    const actualRows = await loadTrainingProfileProjectionRows(db, studentC.studentId);
    expect(actualRows.some((row) => row.metricKey === "accuracy")).toBe(true);

    await db.transaction(async (tx) => {
      await rebuildTrainingProfileProjectionForStudent(tx, studentC.studentId);
    });
    const expectedRows = await loadTrainingProfileProjectionRows(db, studentC.studentId);
    expect(projectionRowsEquivalent(actualRows, expectedRows)).toBe(true);
  });
});
