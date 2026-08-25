import { config } from "dotenv";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { REACTION_TRAINING_KEY } from "@/modules/training/constants";
import { TrainingError } from "@/modules/training/errors";
import {
  getTrainingSessionForStudent,
  startTrainingSession,
  submitTrainingSession,
} from "@/modules/training/session.service";
import { seedStudentUser } from "../../helpers/family-access";
import { closeTestDb, getTestDb, migrateTestDb, resetIdentityTables } from "../../helpers/db";
import { completeReactionSession, ensureReactionDefinitions } from "../../helpers/training";

config({ path: ".env.local" });
config({ path: ".env" });

const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);

const SHARED_START_KEY = "shared-start-idempotency-key";
const SHARED_SUBMIT_KEY = "shared-submit-idempotency-key";

describe.skipIf(!hasDb)("training idempotency student scope", () => {
  const db = getTestDb();

  beforeAll(async () => {
    process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";
    await migrateTestDb();
  });

  beforeEach(async () => {
    await resetIdentityTables(db);
    await ensureReactionDefinitions(db);
  });

  afterAll(async () => {
    await closeTestDb();
  });

  async function seedTwoStudents() {
    const studentA = await seedStudentUser(db, {
      username: `student_a_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
      birthDate: "2015-06-01",
    });
    const studentB = await seedStudentUser(db, {
      username: `student_b_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
      birthDate: "2014-03-15",
    });

    return { studentAId: studentA.studentId, studentBId: studentB.studentId };
  }

  it("isolates start idempotency keys per student", async () => {
    const { studentAId, studentBId } = await seedTwoStudents();

    const startA = await startTrainingSession(db, {
      studentId: studentAId,
      trainingKey: REACTION_TRAINING_KEY,
      idempotencyKey: SHARED_START_KEY,
    });
    const startB = await startTrainingSession(db, {
      studentId: studentBId,
      trainingKey: REACTION_TRAINING_KEY,
      idempotencyKey: SHARED_START_KEY,
    });

    expect(startA.sessionId).not.toBe(startB.sessionId);
    expect(startA.idempotentReplay).toBe(false);
    expect(startB.idempotentReplay).toBe(false);

    const replayA = await startTrainingSession(db, {
      studentId: studentAId,
      trainingKey: REACTION_TRAINING_KEY,
      idempotencyKey: SHARED_START_KEY,
    });
    const replayB = await startTrainingSession(db, {
      studentId: studentBId,
      trainingKey: REACTION_TRAINING_KEY,
      idempotencyKey: SHARED_START_KEY,
    });

    expect(replayA.sessionId).toBe(startA.sessionId);
    expect(replayB.sessionId).toBe(startB.sessionId);
    expect(replayA.idempotentReplay).toBe(true);
    expect(replayB.idempotentReplay).toBe(true);

    const detailA = await getTrainingSessionForStudent(db, studentAId, startA.sessionId);
    const detailB = await getTrainingSessionForStudent(db, studentBId, startB.sessionId);

    expect(detailA.sessionId).toBe(startA.sessionId);
    expect(detailB.sessionId).toBe(startB.sessionId);
    expect(detailA.status).toBe("active");
    expect(detailB.status).toBe("active");
  });

  it("isolates submit idempotency keys per student without leaking metrics", async () => {
    const { studentAId, studentBId } = await seedTwoStudents();

    const resultA = await completeReactionSession(db, studentAId, {
      startIdempotencyKey: `start-a-${SHARED_START_KEY}`,
      submitIdempotencyKey: SHARED_SUBMIT_KEY,
      reactionMs: 300,
    });
    const resultB = await completeReactionSession(db, studentBId, {
      startIdempotencyKey: `start-b-${SHARED_START_KEY}`,
      submitIdempotencyKey: SHARED_SUBMIT_KEY,
      reactionMs: 500,
    });

    expect(resultA.submitted.sessionId).not.toBe(resultB.submitted.sessionId);
    expect(resultA.submitted.status).toBe("completed");
    expect(resultB.submitted.status).toBe("completed");

    const replayA = await submitTrainingSession(db, {
      studentId: studentAId,
      sessionId: resultA.started.sessionId,
      idempotencyKey: SHARED_SUBMIT_KEY,
    });
    const replayB = await submitTrainingSession(db, {
      studentId: studentBId,
      sessionId: resultB.started.sessionId,
      idempotencyKey: SHARED_SUBMIT_KEY,
    });

    expect(replayA.idempotentReplay).toBe(true);
    expect(replayB.idempotentReplay).toBe(true);
    expect(replayA.sessionId).toBe(resultA.started.sessionId);
    expect(replayB.sessionId).toBe(resultB.started.sessionId);
    expect(replayA.metrics).not.toEqual(replayB.metrics);

    const detailA = await getTrainingSessionForStudent(db, studentAId, resultA.started.sessionId);
    const detailB = await getTrainingSessionForStudent(db, studentBId, resultB.started.sessionId);

    expect(detailA.metrics).toEqual(replayA.metrics);
    expect(detailB.metrics).toEqual(replayB.metrics);
    expect(detailA.metrics).not.toEqual(detailB.metrics);
  });

  it("rejects submit idempotency replay against a different session for the same student", async () => {
    const { studentAId } = await seedTwoStudents();

    const sessionOne = await startTrainingSession(db, {
      studentId: studentAId,
      trainingKey: REACTION_TRAINING_KEY,
      idempotencyKey: "start-session-one",
    });
    const completed = await completeReactionSession(db, studentAId, {
      startIdempotencyKey: "start-session-two",
      submitIdempotencyKey: SHARED_SUBMIT_KEY,
      reactionMs: 320,
    });

    await expect(
      submitTrainingSession(db, {
        studentId: studentAId,
        sessionId: sessionOne.sessionId,
        idempotencyKey: SHARED_SUBMIT_KEY,
      }),
    ).rejects.toMatchObject({
      code: "IDEMPOTENCY_SESSION_MISMATCH",
    } satisfies Partial<TrainingError>);

    const replay = await submitTrainingSession(db, {
      studentId: studentAId,
      sessionId: completed.started.sessionId,
      idempotencyKey: SHARED_SUBMIT_KEY,
    });

    expect(replay.idempotentReplay).toBe(true);
    expect(replay.sessionId).toBe(completed.started.sessionId);
  });
});
