import { config } from "dotenv";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { trainingSessions } from "@/db/schema";
import { REACTION_TRAINING_KEY } from "@/modules/training/constants";
import { issueAssociationCode } from "@/modules/family-access/association-code.service";
import {
  acceptRelationshipRequest,
  createRelationshipRequest,
} from "@/modules/family-access/relationship-request.service";
import {
  appendTrainingEvent,
  cancelTrainingSession,
  getTrainingSessionForStudent,
  getTrainingSummaryForParent,
  startTrainingSession,
  submitTrainingSession,
} from "@/modules/training/session.service";
import { bootstrapVerifiedParentWithInvite, seedStudentUser } from "../../helpers/family-access";
import { closeTestDb, getTestDb, migrateTestDb, resetIdentityTables } from "../../helpers/db";
import { completeReactionSession, ensureReactionDefinitions } from "../../helpers/training";

config({ path: ".env.local" });
config({ path: ".env" });

const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("training module", () => {
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

  async function setupLinkedPair() {
    const parentEmail = `parent-${crypto.randomUUID()}@test.local`;
    const { parentId } = await bootstrapVerifiedParentWithInvite(db, parentEmail);
    const student = await seedStudentUser(db, {
      username: `student_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
      birthDate: "2015-06-01",
    });

    const code = await issueAssociationCode(db, {
      studentId: student.studentId,
      idempotencyKey: `issue-${crypto.randomUUID()}`,
    });
    const request = await createRelationshipRequest(db, {
      parentId,
      associationCodePlaintext: code.codePlaintext,
      idempotencyKey: `req-${crypto.randomUUID()}`,
    });
    await acceptRelationshipRequest(db, {
      studentId: student.studentId,
      requestId: request.requestId,
      idempotencyKey: `accept-${crypto.randomUUID()}`,
    });

    return { parentId, studentId: student.studentId };
  }

  it("computes server-side metrics and persists session results for student reload", async () => {
    const student = await seedStudentUser(db, {
      username: "student_training",
      password: "StudentPass123!Student",
      birthDate: "2015-06-01",
    });

    const { submitted } = await completeReactionSession(db, student.studentId, {
      reactionMs: 250,
      startIdempotencyKey: "start-1",
      submitIdempotencyKey: "submit-1",
    });

    expect(submitted.status).toBe("completed");
    expect(submitted.sessionKind).toBe("effective");
    expect(submitted.metrics.find((m) => m.metricKey === "accuracy")?.value).toBe(1);
    expect(
      submitted.metrics.find((m) => m.metricKey === "median_reaction_ms")?.value,
    ).toBeGreaterThan(100);

    const reloaded = await getTrainingSessionForStudent(db, student.studentId, submitted.sessionId);
    expect(reloaded.status).toBe("completed");
    expect(reloaded.metrics).toHaveLength(submitted.metrics.length);
    expect(
      reloaded.metrics.find((m) => m.metricKey === "median_reaction_ms")?.value,
    ).toBeGreaterThan(0);
  });

  it("marks second completed session on same day as practice", async () => {
    const student = await seedStudentUser(db, {
      username: "student_practice",
      password: "StudentPass123!Student",
      birthDate: "2015-06-01",
    });

    const first = await completeReactionSession(db, student.studentId, {
      startIdempotencyKey: "start-a",
      submitIdempotencyKey: "submit-a",
    });
    const second = await completeReactionSession(db, student.studentId, {
      startIdempotencyKey: "start-b",
      submitIdempotencyKey: "submit-b",
    });

    expect(first.submitted.sessionKind).toBe("effective");
    expect(second.submitted.sessionKind).toBe("practice");

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
  });

  it("deduplicates submit by idempotency key", async () => {
    const student = await seedStudentUser(db, {
      username: "student_submit_idem",
      password: "StudentPass123!Student",
      birthDate: "2015-06-01",
    });

    const started = await startTrainingSession(db, {
      studentId: student.studentId,
      trainingKey: REACTION_TRAINING_KEY,
      idempotencyKey: "start-idem",
    });

    for (let trialIndex = 0; trialIndex < 5; trialIndex += 1) {
      await appendTrainingEvent(db, {
        studentId: student.studentId,
        sessionId: started.sessionId,
        sequence: trialIndex * 2,
        eventType: "trial.stimulus",
        payload: { trialIndex },
      });
      await appendTrainingEvent(db, {
        studentId: student.studentId,
        sessionId: started.sessionId,
        sequence: trialIndex * 2 + 1,
        eventType: "trial.response",
        payload: { trialIndex, correct: true, inputMethod: "keyboard" },
      });
      await new Promise((resolve) => setTimeout(resolve, 150));
    }

    const first = await submitTrainingSession(db, {
      studentId: student.studentId,
      sessionId: started.sessionId,
      idempotencyKey: "submit-idem",
    });
    const second = await submitTrainingSession(db, {
      studentId: student.studentId,
      sessionId: started.sessionId,
      idempotencyKey: "submit-idem",
    });

    expect(first.idempotentReplay).toBe(false);
    expect(second.idempotentReplay).toBe(true);
    expect(second.sessionId).toBe(first.sessionId);
  });

  it("marks invalid sessions when events are incomplete", async () => {
    const student = await seedStudentUser(db, {
      username: "student_invalid",
      password: "StudentPass123!Student",
      birthDate: "2015-06-01",
    });

    const started = await startTrainingSession(db, {
      studentId: student.studentId,
      trainingKey: REACTION_TRAINING_KEY,
      idempotencyKey: "start-invalid",
    });

    await appendTrainingEvent(db, {
      studentId: student.studentId,
      sessionId: started.sessionId,
      sequence: 0,
      eventType: "trial.stimulus",
      payload: { trialIndex: 0 },
    });

    const submitted = await submitTrainingSession(db, {
      studentId: student.studentId,
      sessionId: started.sessionId,
      idempotencyKey: "submit-invalid",
    });

    expect(submitted.status).toBe("invalid");
    expect(submitted.metrics).toHaveLength(0);
  });

  it("abandons sessions when blur exceeds threshold", async () => {
    const student = await seedStudentUser(db, {
      username: "student_abandon",
      password: "StudentPass123!Student",
      birthDate: "2015-06-01",
    });

    const started = await startTrainingSession(db, {
      studentId: student.studentId,
      trainingKey: REACTION_TRAINING_KEY,
      idempotencyKey: "start-abandon",
    });

    const result = await appendTrainingEvent(db, {
      studentId: student.studentId,
      sessionId: started.sessionId,
      sequence: 0,
      eventType: "session.blur",
      payload: { durationMs: 31_000 },
    });

    expect(result.abandoned).toBe(true);

    const reloaded = await getTrainingSessionForStudent(db, student.studentId, started.sessionId);
    expect(reloaded.status).toBe("abandoned");
  });

  it("cancels active sessions without persisting metrics", async () => {
    const student = await seedStudentUser(db, {
      username: "student_cancel",
      password: "StudentPass123!Student",
      birthDate: "2015-06-01",
    });

    const started = await startTrainingSession(db, {
      studentId: student.studentId,
      trainingKey: REACTION_TRAINING_KEY,
      idempotencyKey: "start-cancel",
    });

    const cancelled = await cancelTrainingSession(db, {
      studentId: student.studentId,
      sessionId: started.sessionId,
    });
    expect(cancelled.status).toBe("cancelled");

    const reloaded = await getTrainingSessionForStudent(db, student.studentId, started.sessionId);
    expect(reloaded.status).toBe("cancelled");
    expect(reloaded.metrics).toHaveLength(0);
  });

  it("allows linked parent to read summary only after relationship is active", async () => {
    const { parentId, studentId } = await setupLinkedPair();
    const { submitted } = await completeReactionSession(db, studentId);

    const summary = await getTrainingSummaryForParent(db, parentId, studentId);
    expect(summary.lastSession?.sessionId).toBe(submitted.sessionId);
    expect(summary.lastSession?.metrics.some((m) => m.metricKey === "accuracy")).toBe(true);
    expect(summary.projection.length).toBeGreaterThan(0);
  });
});
