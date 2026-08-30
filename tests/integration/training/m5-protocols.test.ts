import { config } from "dotenv";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { auditEvents, outboxEvents, trainingDefinitions, trainingSessions } from "@/db/schema";
import {
  DIGIT_SPAN_TRAINING_KEY,
  REACTION_TRAINING_KEY,
  STROOP_TRAINING_KEY,
} from "@/modules/training/constants";
import { getActiveTrainingDefinition } from "@/modules/training/definition.service";
import {
  appendTrainingEvent,
  startTrainingSession,
  submitTrainingSession,
} from "@/modules/training/session.service";
import { seedStudentUser } from "../../helpers/family-access";
import {
  completeDigitSpanSession,
  completeReactionSession,
  completeStroopSession,
  ensureM5TrainingDefinitions,
} from "../../helpers/training";
import { closeTestDb, getTestDb, migrateTestDb, resetIdentityTables } from "../../helpers/db";

config({ path: ".env.local" });
config({ path: ".env" });

const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("M5 training protocols", () => {
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

  it("seeds active Stroop and digit-span definitions for all age bands", async () => {
    for (const ageBand of ["5-8", "9-12", "13-18"] as const) {
      const stroop = await getActiveTrainingDefinition(db, STROOP_TRAINING_KEY, ageBand);
      const digitSpan = await getActiveTrainingDefinition(db, DIGIT_SPAN_TRAINING_KEY, ageBand);
      expect(stroop.version).toBe(1);
      expect(digitSpan.version).toBe(1);
      expect(stroop.metricSchema).toMatchObject({ trialCount: expect.any(Number) });
      expect(digitSpan.metricSchema).toMatchObject({ forwardMaxLength: expect.any(Number) });
    }
  });

  it("completes Stroop sessions with typed metrics and interference delta", async () => {
    const student = await seedStudentUser(db, {
      username: `stroop_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
      birthDate: "2015-06-01",
    });

    const { submitted } = await completeStroopSession(db, student.studentId);
    expect(submitted.status).toBe("completed");
    expect(submitted.sessionKind).toBe("effective");
    expect(submitted.metrics.some((metric) => metric.metricKey === "interference_delta")).toBe(
      true,
    );
    expect(submitted.metrics.some((metric) => metric.metricKey === "congruent_accuracy")).toBe(
      true,
    );
  });

  it("completes digit-span sessions with separate forward and backward max spans", async () => {
    const student = await seedStudentUser(db, {
      username: `digit_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
      birthDate: "2015-06-01",
    });

    const { submitted } = await completeDigitSpanSession(db, student.studentId);
    expect(submitted.status).toBe("completed");
    expect(
      submitted.metrics.find((metric) => metric.metricKey === "forward_max_span")?.value,
    ).toBeGreaterThan(0);
    expect(
      submitted.metrics.find((metric) => metric.metricKey === "backward_max_span")?.value,
    ).toBeGreaterThan(0);
  });

  it("allows one effective session per training key on the same family date", async () => {
    const student = await seedStudentUser(db, {
      username: `triple_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
      birthDate: "2015-06-01",
    });

    const reaction = await completeReactionSession(db, student.studentId, {
      startIdempotencyKey: "triple-reaction-start",
      submitIdempotencyKey: "triple-reaction-submit",
    });
    const stroop = await completeStroopSession(db, student.studentId, {
      startIdempotencyKey: "triple-stroop-start",
      submitIdempotencyKey: "triple-stroop-submit",
    });
    const digitSpan = await completeDigitSpanSession(db, student.studentId, {
      startIdempotencyKey: "triple-digit-start",
      submitIdempotencyKey: "triple-digit-submit",
    });

    expect(reaction.submitted.sessionKind).toBe("effective");
    expect(stroop.submitted.sessionKind).toBe("effective");
    expect(digitSpan.submitted.sessionKind).toBe("effective");

    const effectiveRows = await db
      .select()
      .from(trainingSessions)
      .where(
        and(
          eq(trainingSessions.studentId, student.studentId),
          eq(trainingSessions.sessionKind, "effective"),
          eq(trainingSessions.status, "completed"),
        ),
      );
    expect(effectiveRows).toHaveLength(3);
  });

  it("marks invalid Stroop sessions when medians are unavailable", async () => {
    const student = await seedStudentUser(db, {
      username: `stroop_invalid_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
      birthDate: "2015-06-01",
    });

    const started = await startTrainingSession(db, {
      studentId: student.studentId,
      trainingKey: STROOP_TRAINING_KEY,
      idempotencyKey: "stroop-invalid-start",
    });

    let sequence = 0;
    for (let trialIndex = 0; trialIndex < started.expectedTrialCount; trialIndex += 1) {
      const congruent = trialIndex < started.expectedTrialCount / 2;
      await appendTrainingEvent(db, {
        studentId: student.studentId,
        sessionId: started.sessionId,
        sequence,
        eventType: "trial.stimulus",
        payload: {
          trialIndex,
          inkColor: "red",
          wordColor: congruent ? "red" : "blue",
        },
      });
      sequence += 1;
      await appendTrainingEvent(db, {
        studentId: student.studentId,
        sessionId: started.sessionId,
        sequence,
        eventType: "trial.response",
        payload: {
          trialIndex,
          selectedColor: congruent ? "red" : "blue",
        },
      });
      sequence += 1;
    }

    const submitted = await submitTrainingSession(db, {
      studentId: student.studentId,
      sessionId: started.sessionId,
      idempotencyKey: "stroop-invalid-submit",
    });
    expect(submitted.status).toBe("invalid");
  });

  it("does not leak answers or full sequences in audit or outbox payloads", async () => {
    const student = await seedStudentUser(db, {
      username: `privacy_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
      birthDate: "2015-06-01",
    });

    await completeStroopSession(db, student.studentId, {
      startIdempotencyKey: "privacy-stroop-start",
      submitIdempotencyKey: "privacy-stroop-submit",
    });
    await completeDigitSpanSession(db, student.studentId, {
      startIdempotencyKey: "privacy-digit-start",
      submitIdempotencyKey: "privacy-digit-submit",
    });

    const auditSerialized = JSON.stringify(await db.select().from(auditEvents));
    const outboxSerialized = JSON.stringify(await db.select().from(outboxEvents));
    for (const forbidden of ['"sequence":[', '"selectedColor"', '"response":[', '"inkColor"']) {
      expect(auditSerialized).not.toContain(forbidden);
      expect(outboxSerialized).not.toContain(forbidden);
    }
  });

  it("deduplicates submit retries on the same session without duplicate outbox rows", async () => {
    const student = await seedStudentUser(db, {
      username: `idem_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
      birthDate: "2015-06-01",
    });

    const { started, submitted: first } = await completeStroopSession(db, student.studentId, {
      startIdempotencyKey: "idem-stroop-start",
      submitIdempotencyKey: "idem-stroop-submit",
    });
    const second = await submitTrainingSession(db, {
      studentId: student.studentId,
      sessionId: started.sessionId,
      idempotencyKey: "idem-stroop-submit",
    });

    expect(first.idempotentReplay).toBe(false);
    expect(second.idempotentReplay).toBe(true);
    expect(second.sessionId).toBe(first.sessionId);

    const outboxRows = await db
      .select()
      .from(outboxEvents)
      .where(
        eq(
          outboxEvents.dedupeKey,
          `outbox:training-complete:${student.studentId}:idem-stroop-submit`,
        ),
      );
    expect(outboxRows).toHaveLength(1);
  });
});
