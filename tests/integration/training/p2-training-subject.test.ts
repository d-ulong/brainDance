import { config } from "dotenv";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  auditEvents,
  outboxEvents,
  pointLedgerEntries,
  scheduleItems,
  trainingProfileProjection,
  trainingSessions,
} from "@/db/schema";
import { bootstrapAdmin } from "../../helpers/identity";
import { bootstrapVerifiedParentWithInvite, seedStudentUser } from "../../helpers/family-access";
import { closeTestDb, getTestDb, migrateTestDb, resetIdentityTables } from "../../helpers/db";
import { completeReactionSession, ensureM5TrainingDefinitions } from "../../helpers/training";
import { REACTION_TRAINING_KEY } from "@/modules/training/constants";
import { TrainingError } from "@/modules/training/errors";
import {
  appendTrainingEventForSubject,
  cancelTrainingSessionForSubject,
  getTrainingSessionForSubject,
  startTrainingSessionForSubject,
  submitTrainingSessionForSubject,
} from "@/modules/training/session.service";
import { rebuildTrainingProfileProjectionForTrainee } from "@/modules/training/trends.service";
import { resolveTrainingSubject } from "@/modules/training/training-subject";

config({ path: ".env.local" });
config({ path: ".env" });

const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("P2 training subject isolation", () => {
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

  async function appendMinimalReactionEvents(
    subject: Awaited<ReturnType<typeof resolveTrainingSubject>>,
    sessionId: string,
  ) {
    let sequence = 0;
    for (let trialIndex = 0; trialIndex < 5; trialIndex += 1) {
      await appendTrainingEventForSubject(db, {
        subject,
        sessionId,
        sequence,
        eventType: "trial.stimulus",
        payload: { trialIndex, stimulusId: `s-${trialIndex}` },
      });
      sequence += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      await appendTrainingEventForSubject(db, {
        subject,
        sessionId,
        sequence,
        eventType: "trial.response",
        payload: { trialIndex, correct: true, inputMethod: "keyboard" },
      });
      sequence += 1;
    }
  }

  it("lets parent use adult definitions for own session lifecycle", async () => {
    const parentEmail = `parent-train-${crypto.randomUUID()}@test.local`;
    const { parentId } = await bootstrapVerifiedParentWithInvite(db, parentEmail);
    const subject = await resolveTrainingSubject(db, parentId);
    expect(subject).toMatchObject({
      traineeId: parentId,
      traineeRole: "parent",
      ageBand: "adult",
    });

    const started = await startTrainingSessionForSubject(db, {
      subject,
      trainingKey: REACTION_TRAINING_KEY,
      idempotencyKey: "parent-start-1",
    });
    expect(started.ageBand).toBe("adult");
    expect(started.idempotentReplay).toBe(false);

    const [row] = await db
      .select()
      .from(trainingSessions)
      .where(eq(trainingSessions.id, started.sessionId))
      .limit(1);
    expect(row?.traineeId).toBe(parentId);
    expect(row?.studentId).toBeNull();
    expect(row?.ageBand).toBe("adult");

    await appendMinimalReactionEvents(subject, started.sessionId);
    const submitted = await submitTrainingSessionForSubject(db, {
      subject,
      sessionId: started.sessionId,
      idempotencyKey: "parent-submit-1",
    });
    expect(submitted.status).toBe("completed");
    expect(submitted.sessionKind).toBe("effective");

    const detail = await getTrainingSessionForSubject(db, subject, started.sessionId);
    expect(detail.status).toBe("completed");
    expect(detail.ageBand).toBe("adult");
  });

  it("isolates parent and student sessions and blocks cross-subject access", async () => {
    const parentEmail = `parent-iso-${crypto.randomUUID()}@test.local`;
    const { parentId } = await bootstrapVerifiedParentWithInvite(db, parentEmail);
    const student = await seedStudentUser(db, {
      username: `student_iso_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
      birthDate: "2015-06-01",
    });

    const parentSubject = await resolveTrainingSubject(db, parentId);
    const studentSubject = await resolveTrainingSubject(db, student.studentId);

    const parentStarted = await startTrainingSessionForSubject(db, {
      subject: parentSubject,
      trainingKey: REACTION_TRAINING_KEY,
      idempotencyKey: "iso-parent-start",
    });
    const studentStarted = await startTrainingSessionForSubject(db, {
      subject: studentSubject,
      trainingKey: REACTION_TRAINING_KEY,
      idempotencyKey: "iso-student-start",
    });

    await expect(
      getTrainingSessionForSubject(db, parentSubject, studentStarted.sessionId),
    ).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" } satisfies Partial<TrainingError>);
    await expect(
      getTrainingSessionForSubject(db, studentSubject, parentStarted.sessionId),
    ).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" } satisfies Partial<TrainingError>);
    await expect(
      appendTrainingEventForSubject(db, {
        subject: parentSubject,
        sessionId: studentStarted.sessionId,
        sequence: 0,
        eventType: "trial.stimulus",
        payload: { trialIndex: 0 },
      }),
    ).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" });
    await expect(
      cancelTrainingSessionForSubject(db, {
        subject: studentSubject,
        sessionId: parentStarted.sessionId,
      }),
    ).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" });

    await expect(
      resolveTrainingSubject(db, (await bootstrapAdmin(db)).adminId),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("allows same-day effective sessions for parent and student without mixing student domains", async () => {
    const parentEmail = `parent-side-${crypto.randomUUID()}@test.local`;
    const { parentId } = await bootstrapVerifiedParentWithInvite(db, parentEmail);
    const student = await seedStudentUser(db, {
      username: `student_side_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
      birthDate: "2015-06-01",
    });

    const parentSubject = await resolveTrainingSubject(db, parentId);
    const studentCompleted = await completeReactionSession(db, student.studentId, {
      startIdempotencyKey: "side-student-start",
      submitIdempotencyKey: "side-student-submit",
    });

    const beforeStudentProjection = await db
      .select()
      .from(trainingProfileProjection)
      .where(eq(trainingProfileProjection.traineeId, student.studentId));
    const beforeLedger = await db
      .select({ id: pointLedgerEntries.id })
      .from(pointLedgerEntries)
      .where(eq(pointLedgerEntries.studentId, student.studentId));
    const beforeSchedule = await db.select({ id: scheduleItems.id }).from(scheduleItems);
    const beforeStudentOutbox = await db
      .select({ id: outboxEvents.id })
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.eventType, "training_session.completed"),
          sql`${outboxEvents.payload}->>'studentId' = ${student.studentId}`,
        ),
      );

    const parentStarted = await startTrainingSessionForSubject(db, {
      subject: parentSubject,
      trainingKey: REACTION_TRAINING_KEY,
      idempotencyKey: "side-parent-start",
    });
    await appendMinimalReactionEvents(parentSubject, parentStarted.sessionId);
    const parentSubmitted = await submitTrainingSessionForSubject(db, {
      subject: parentSubject,
      sessionId: parentStarted.sessionId,
      idempotencyKey: "side-parent-submit",
    });
    expect(parentSubmitted.sessionKind).toBe("effective");
    expect(studentCompleted.submitted.sessionKind).toBe("effective");

    const effectiveRows = await db
      .select()
      .from(trainingSessions)
      .where(
        and(
          eq(trainingSessions.trainingKey, REACTION_TRAINING_KEY),
          eq(trainingSessions.sessionKind, "effective"),
          eq(trainingSessions.status, "completed"),
        ),
      );
    expect(effectiveRows).toHaveLength(2);

    const parentOutbox = await db
      .select()
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.eventType, "training_session.completed"),
          sql`${outboxEvents.payload}->>'traineeId' = ${parentId}`,
        ),
      );
    expect(parentOutbox).toHaveLength(0);

    const afterStudentProjection = await db
      .select()
      .from(trainingProfileProjection)
      .where(eq(trainingProfileProjection.traineeId, student.studentId));
    expect(afterStudentProjection).toEqual(beforeStudentProjection);

    const parentProjection = await db
      .select()
      .from(trainingProfileProjection)
      .where(eq(trainingProfileProjection.traineeId, parentId));
    expect(parentProjection.length).toBeGreaterThan(0);
    expect(parentProjection.every((row) => row.studentId === null)).toBe(true);
    expect(parentProjection.every((row) => row.ageBand === "adult")).toBe(true);

    const afterLedger = await db
      .select({ id: pointLedgerEntries.id })
      .from(pointLedgerEntries)
      .where(eq(pointLedgerEntries.studentId, student.studentId));
    expect(afterLedger).toEqual(beforeLedger);

    const afterSchedule = await db.select({ id: scheduleItems.id }).from(scheduleItems);
    expect(afterSchedule).toEqual(beforeSchedule);

    const afterStudentOutbox = await db
      .select({ id: outboxEvents.id })
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.eventType, "training_session.completed"),
          sql`${outboxEvents.payload}->>'studentId' = ${student.studentId}`,
        ),
      );
    expect(afterStudentOutbox).toEqual(beforeStudentOutbox);

    const rebuilt = await db.transaction(async (tx) =>
      rebuildTrainingProfileProjectionForTrainee(tx, parentId),
    );
    expect(rebuilt.sessionsScanned).toBeGreaterThan(0);
    expect(rebuilt.projectionRowsWritten).toBeGreaterThan(0);

    const audits = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.actorId, parentId),
          eq(auditEvents.action, "training_session.completed"),
        ),
      );
    expect(audits.length).toBeGreaterThan(0);
  });
});
