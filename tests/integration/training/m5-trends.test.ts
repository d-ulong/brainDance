import { config } from "dotenv";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  trainingDefinitions,
  trainingProfileProjection,
  trainingSessions,
  users,
  relationships,
} from "@/db/schema";
import {
  DIGIT_SPAN_TRAINING_KEY,
  REACTION_TRAINING_KEY,
  STROOP_TRAINING_KEY,
} from "@/modules/training/constants";
import { FamilyAccessError } from "@/modules/family-access/errors";
import { endRelationship } from "@/modules/family-access/end-relationship.service";
import { issueAssociationCode } from "@/modules/family-access/association-code.service";
import {
  acceptRelationshipRequest,
  createRelationshipRequest,
} from "@/modules/family-access/relationship-request.service";
import { requireStudentReadAccess } from "@/app/api/_lib/student-read-access";
import {
  appendTrainingEvent,
  cancelTrainingSession,
  startTrainingSession,
  submitTrainingSession,
} from "@/modules/training/session.service";
import {
  loadTrainingProfileProjectionRows,
  projectionRowsEquivalent,
  queryTrainingTrends,
  rebuildTrainingProfileProjectionForStudent,
} from "@/modules/training/trends.service";
import { addFamilyDays } from "@/modules/time-policy/add-family-days";
import { bootstrapVerifiedParentWithInvite, seedStudentUser } from "../../helpers/family-access";
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

describe.skipIf(!hasDb)("M5 training trends", () => {
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

    return { parentId, studentId: student.studentId, studentUserId: student.studentId };
  }

  it("AC-M5-05: returns empty segments when no effective completed sessions exist", async () => {
    const student = await seedStudentUser(db, {
      username: `empty_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
      birthDate: "2015-06-01",
    });

    const trends = await queryTrainingTrends(db, {
      studentId: student.studentId,
      trainingKey: REACTION_TRAINING_KEY,
      window: "7d",
      referenceFamilyDate: "2026-08-31",
    });

    expect(trends.hasData).toBe(false);
    expect(trends.segments).toHaveLength(0);
    expect(trends.partialCoverage).toBe(false);
  });

  it("AC-M5-05 / AC-M5-06: excludes practice, invalid, abandoned, and cancelled sessions", async () => {
    const student = await seedStudentUser(db, {
      username: `exclude_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
      birthDate: "2015-06-01",
    });

    const effective = await completeReactionSession(db, student.studentId, {
      startIdempotencyKey: "effective-start",
      submitIdempotencyKey: "effective-submit",
    });
    await completeReactionSession(db, student.studentId, {
      startIdempotencyKey: "practice-start",
      submitIdempotencyKey: "practice-submit",
    });

    const cancelled = await startTrainingSession(db, {
      studentId: student.studentId,
      trainingKey: REACTION_TRAINING_KEY,
      idempotencyKey: "cancel-start",
    });
    await cancelTrainingSession(db, {
      studentId: student.studentId,
      sessionId: cancelled.sessionId,
    });

    const referenceFamilyDate = "2026-08-31";
    await db
      .update(trainingSessions)
      .set({ familyDate: referenceFamilyDate })
      .where(eq(trainingSessions.studentId, student.studentId));

    const trends = await queryTrainingTrends(db, {
      studentId: student.studentId,
      trainingKey: REACTION_TRAINING_KEY,
      window: "all",
      referenceFamilyDate,
    });

    expect(trends.hasData).toBe(true);
    expect(trends.segments).toHaveLength(1);
    expect(trends.segments[0]?.points).toHaveLength(1);
    expect(trends.segments[0]?.points[0]?.sessionId).toBe(effective.submitted.sessionId);
    expect(trends.segments[0]?.points[0]?.sessionKind).toBe("effective");
  });

  it("AC-M5-05: 7d window and partialCoverage flag exclude older effective sessions", async () => {
    const student = await seedStudentUser(db, {
      username: `window_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
      birthDate: "2015-06-01",
    });

    const older = await completeReactionSession(db, student.studentId, {
      startIdempotencyKey: "older-start",
      submitIdempotencyKey: "older-submit",
    });

    const referenceFamilyDate = "2026-08-31";
    await db
      .update(trainingSessions)
      .set({ familyDate: addFamilyDays(referenceFamilyDate, -10) })
      .where(eq(trainingSessions.id, older.submitted.sessionId));

    const recent = await completeReactionSession(db, student.studentId, {
      startIdempotencyKey: "recent-start",
      submitIdempotencyKey: "recent-submit",
    });
    await db
      .update(trainingSessions)
      .set({ familyDate: referenceFamilyDate })
      .where(eq(trainingSessions.id, recent.submitted.sessionId));

    const trends = await queryTrainingTrends(db, {
      studentId: student.studentId,
      trainingKey: REACTION_TRAINING_KEY,
      window: "7d",
      referenceFamilyDate,
    });

    expect(trends.partialCoverage).toBe(true);
    expect(trends.windowStartFamilyDate).toBe(addFamilyDays(referenceFamilyDate, -6));
    expect(trends.segments[0]?.points).toHaveLength(1);
    expect(trends.segments[0]?.points[0]?.sessionId).toBe(recent.submitted.sessionId);
  });

  it("AC-M5-05: segments by definition version without connecting points", async () => {
    const student = await seedStudentUser(db, {
      username: `version_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
      birthDate: "2015-06-01",
    });

    const v1 = await completeReactionSession(db, student.studentId, {
      startIdempotencyKey: "v1-start",
      submitIdempotencyKey: "v1-submit",
    });

    await db
      .update(trainingSessions)
      .set({ familyDate: "2026-08-20" })
      .where(eq(trainingSessions.id, v1.submitted.sessionId));

    await db
      .update(trainingDefinitions)
      .set({ active: 0 })
      .where(
        and(
          eq(trainingDefinitions.trainingKey, REACTION_TRAINING_KEY),
          eq(trainingDefinitions.ageBand, v1.started.ageBand),
        ),
      );

    await db.insert(trainingDefinitions).values({
      trainingKey: REACTION_TRAINING_KEY,
      version: 2,
      ageBand: v1.started.ageBand,
      metricSchema: { trialCount: 5 },
      active: 1,
    });

    const v2 = await completeReactionSession(db, student.studentId, {
      startIdempotencyKey: "v2-start",
      submitIdempotencyKey: "v2-submit",
    });

    const referenceFamilyDate = "2026-08-31";
    await db
      .update(trainingSessions)
      .set({ familyDate: referenceFamilyDate })
      .where(eq(trainingSessions.id, v2.submitted.sessionId));

    const trends = await queryTrainingTrends(db, {
      studentId: student.studentId,
      trainingKey: REACTION_TRAINING_KEY,
      window: "all",
      referenceFamilyDate,
    });

    expect(trends.segments).toHaveLength(2);
    expect(trends.segments[0]?.definitionVersion).toBe(1);
    expect(trends.segments[0]?.segmentReason).toBe("initial");
    expect(trends.segments[1]?.definitionVersion).toBe(2);
    expect(trends.segments[1]?.segmentReason).toBe("definition_version_change");
    expect(trends.segments[0]?.points).toHaveLength(1);
    expect(trends.segments[1]?.points).toHaveLength(1);
  });

  it("AC-M5-05: segments by age band without connecting points", async () => {
    const student = await seedStudentUser(db, {
      username: `age_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
      birthDate: "2015-06-01",
    });

    const bandA = await completeStroopSession(db, student.studentId, {
      startIdempotencyKey: "band-a-start",
      submitIdempotencyKey: "band-a-submit",
    });

    await db
      .update(trainingSessions)
      .set({ ageBand: "9-12", familyDate: "2026-08-10" })
      .where(eq(trainingSessions.id, bandA.submitted.sessionId));

    const bandB = await completeStroopSession(db, student.studentId, {
      startIdempotencyKey: "band-b-start",
      submitIdempotencyKey: "band-b-submit",
    });

    await db
      .update(trainingSessions)
      .set({ ageBand: "13-18", familyDate: "2026-08-20" })
      .where(eq(trainingSessions.id, bandB.submitted.sessionId));

    const trends = await queryTrainingTrends(db, {
      studentId: student.studentId,
      trainingKey: STROOP_TRAINING_KEY,
      window: "all",
      referenceFamilyDate: "2026-08-31",
    });

    expect(trends.segments).toHaveLength(2);
    expect(trends.segments[0]?.ageBand).toBe("9-12");
    expect(trends.segments[1]?.ageBand).toBe("13-18");
    expect(trends.segments[1]?.segmentReason).toBe("age_band_change");
  });

  it("AC-M5-05 / AC-M5-03: digit-span trend points include per-length attempt summaries", async () => {
    const student = await seedStudentUser(db, {
      username: `digit_trend_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
      birthDate: "2015-06-01",
    });

    const completed = await completeDigitSpanSession(db, student.studentId, {
      startIdempotencyKey: "digit-trend-start",
      submitIdempotencyKey: "digit-trend-submit",
    });

    const referenceFamilyDate = "2026-08-31";
    await db
      .update(trainingSessions)
      .set({ familyDate: referenceFamilyDate })
      .where(eq(trainingSessions.id, completed.submitted.sessionId));

    const trends = await queryTrainingTrends(db, {
      studentId: student.studentId,
      trainingKey: DIGIT_SPAN_TRAINING_KEY,
      window: "all",
      referenceFamilyDate,
    });

    const point = trends.segments[0]?.points[0];
    expect(point?.metrics.some((metric) => metric.metricKey === "forward_max_span")).toBe(true);
    expect(point?.digitSpanAttempts?.length).toBeGreaterThan(0);
    expect(point?.digitSpanAttempts?.[0]).toMatchObject({
      mode: expect.stringMatching(/forward|backward/),
      length: expect.any(Number),
      attemptIndex: expect.any(Number),
      correct: expect.any(Boolean),
    });
  });

  it("AC-M5-06: rebuild matches incremental projection rows", async () => {
    const student = await seedStudentUser(db, {
      username: `rebuild_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
      birthDate: "2015-06-01",
    });

    await completeReactionSession(db, student.studentId, {
      startIdempotencyKey: "rebuild-r1",
      submitIdempotencyKey: "rebuild-r1-submit",
    });
    await completeStroopSession(db, student.studentId, {
      startIdempotencyKey: "rebuild-s1",
      submitIdempotencyKey: "rebuild-s1-submit",
    });
    await completeReactionSession(db, student.studentId, {
      startIdempotencyKey: "rebuild-r2",
      submitIdempotencyKey: "rebuild-r2-submit",
    });

    const incrementalRows = await loadTrainingProfileProjectionRows(db, student.studentId);

    await db
      .update(trainingProfileProjection)
      .set({ bestValue: "0.000000" })
      .where(eq(trainingProfileProjection.studentId, student.studentId));

    await db.transaction(async (tx) => {
      await rebuildTrainingProfileProjectionForStudent(tx, student.studentId);
    });

    const rebuiltRows = await loadTrainingProfileProjectionRows(db, student.studentId);
    expect(
      projectionRowsEquivalent(
        incrementalRows.map((row) => ({
          trainingKey: row.trainingKey,
          definitionVersion: row.definitionVersion,
          ageBand: row.ageBand,
          metricKey: row.metricKey,
          bestValue: row.bestValue,
          lastValue: row.lastValue,
          lastSourceSessionId: row.lastSourceSessionId,
          windowSummary: row.windowSummary,
        })),
        rebuiltRows.map((row) => ({
          trainingKey: row.trainingKey,
          definitionVersion: row.definitionVersion,
          ageBand: row.ageBand,
          metricKey: row.metricKey,
          bestValue: row.bestValue,
          lastValue: row.lastValue,
          lastSourceSessionId: row.lastSourceSessionId,
          windowSummary: row.windowSummary,
        })),
      ),
    ).toBe(true);
  });

  it("P2-R02 / P2-R03: second effective session updates last fields and lastFamilyDate", async () => {
    const student = await seedStudentUser(db, {
      username: `last_family_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
      birthDate: "2015-06-01",
    });

    async function completeReactionWithFamilyDate(
      familyDate: string,
      reactionMs: number,
      keys: { start: string; submit: string },
    ) {
      const started = await startTrainingSession(db, {
        studentId: student.studentId,
        trainingKey: REACTION_TRAINING_KEY,
        idempotencyKey: keys.start,
      });
      await db
        .update(trainingSessions)
        .set({ familyDate })
        .where(eq(trainingSessions.id, started.sessionId));

      let sequence = 0;
      for (let trialIndex = 0; trialIndex < 5; trialIndex += 1) {
        await appendTrainingEvent(db, {
          studentId: student.studentId,
          sessionId: started.sessionId,
          sequence,
          eventType: "trial.stimulus",
          payload: { trialIndex, stimulusId: `s-${trialIndex}` },
        });
        sequence += 1;
        await new Promise((resolve) => setTimeout(resolve, reactionMs));
        await appendTrainingEvent(db, {
          studentId: student.studentId,
          sessionId: started.sessionId,
          sequence,
          eventType: "trial.response",
          payload: { trialIndex, correct: true, inputMethod: "keyboard" },
        });
        sequence += 1;
      }

      return submitTrainingSession(db, {
        studentId: student.studentId,
        sessionId: started.sessionId,
        idempotencyKey: keys.submit,
      });
    }

    await completeReactionWithFamilyDate("2026-08-20", 350, {
      start: "last-family-1-start",
      submit: "last-family-1-submit",
    });
    const second = await completeReactionWithFamilyDate("2026-08-25", 500, {
      start: "last-family-2-start",
      submit: "last-family-2-submit",
    });

    const incrementalRows = await loadTrainingProfileProjectionRows(db, student.studentId);
    const accuracyRow = incrementalRows.find((row) => row.metricKey === "accuracy");
    const medianRow = incrementalRows.find((row) => row.metricKey === "median_reaction_ms");

    expect(accuracyRow?.lastSourceSessionId).toBe(second.sessionId);
    expect((accuracyRow?.windowSummary as { lastFamilyDate?: string })?.lastFamilyDate).toBe(
      "2026-08-25",
    );
    expect(medianRow?.lastSourceSessionId).toBe(second.sessionId);
    expect(Number(medianRow?.bestValue)).toBeLessThan(Number(medianRow?.lastValue));

    await db.transaction(async (tx) => {
      await rebuildTrainingProfileProjectionForStudent(tx, student.studentId);
    });

    const rebuiltRows = await loadTrainingProfileProjectionRows(db, student.studentId);
    expect(
      projectionRowsEquivalent(
        incrementalRows.map((row) => ({
          trainingKey: row.trainingKey,
          definitionVersion: row.definitionVersion,
          ageBand: row.ageBand,
          metricKey: row.metricKey,
          bestValue: row.bestValue,
          lastValue: row.lastValue,
          lastSourceSessionId: row.lastSourceSessionId,
          windowSummary: row.windowSummary,
        })),
        rebuiltRows.map((row) => ({
          trainingKey: row.trainingKey,
          definitionVersion: row.definitionVersion,
          ageBand: row.ageBand,
          metricKey: row.metricKey,
          bestValue: row.bestValue,
          lastValue: row.lastValue,
          lastSourceSessionId: row.lastSourceSessionId,
          windowSummary: row.windowSummary,
        })),
      ),
    ).toBe(true);
  });

  it("P2-R03: projection excludes non-eligible metrics via shared reducer", async () => {
    const student = await seedStudentUser(db, {
      username: `exclude_metric_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
      birthDate: "2015-06-01",
    });

    await completeReactionSession(db, student.studentId, {
      startIdempotencyKey: "exclude-metric-start",
      submitIdempotencyKey: "exclude-metric-submit",
    });

    const rows = await loadTrainingProfileProjectionRows(db, student.studentId);
    expect(rows.some((row) => row.metricKey === "total_trial_count")).toBe(false);
    expect(rows.some((row) => row.metricKey === "accuracy")).toBe(true);
  });

  it("AC-M5-07: student self-read succeeds and cross-student read is forbidden", async () => {
    const studentA = await seedStudentUser(db, {
      username: `student_a_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
      birthDate: "2015-06-01",
    });
    const studentB = await seedStudentUser(db, {
      username: `student_b_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
      birthDate: "2015-06-01",
    });

    await completeReactionSession(db, studentA.studentId, {
      startIdempotencyKey: "self-read-start",
      submitIdempotencyKey: "self-read-submit",
    });

    const [studentAUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, studentA.studentId))
      .limit(1);

    await expect(
      requireStudentReadAccess(db, studentAUser!, studentA.studentId),
    ).resolves.toBeUndefined();

    await expect(
      requireStudentReadAccess(db, studentAUser!, studentB.studentId),
    ).rejects.toBeInstanceOf(FamilyAccessError);
    await expect(
      requireStudentReadAccess(db, studentAUser!, studentB.studentId),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    const trends = await queryTrainingTrends(db, {
      studentId: studentA.studentId,
      trainingKey: REACTION_TRAINING_KEY,
      window: "all",
      referenceFamilyDate: "2026-08-31",
    });
    expect(trends.hasData).toBe(true);
  });

  it("AC-M5-07: ending one parent relationship blocks only that parent", async () => {
    const { parentId: parent1Id, studentId } = await setupLinkedPair();

    const parent2Email = `parent2-${crypto.randomUUID()}@test.local`;
    const { parentId: parent2Id } = await bootstrapVerifiedParentWithInvite(db, parent2Email);
    const code = await issueAssociationCode(db, {
      studentId,
      idempotencyKey: `issue2-${crypto.randomUUID()}`,
    });
    const request = await createRelationshipRequest(db, {
      parentId: parent2Id,
      associationCodePlaintext: code.codePlaintext,
      idempotencyKey: `req2-${crypto.randomUUID()}`,
    });
    await acceptRelationshipRequest(db, {
      studentId,
      requestId: request.requestId,
      idempotencyKey: `accept2-${crypto.randomUUID()}`,
    });

    await completeReactionSession(db, studentId, {
      startIdempotencyKey: "multi-parent-start",
      submitIdempotencyKey: "multi-parent-submit",
    });

    const [[parent1User], [parent2User]] = await Promise.all([
      db.select().from(users).where(eq(users.id, parent1Id)).limit(1),
      db.select().from(users).where(eq(users.id, parent2Id)).limit(1),
    ]);

    await expect(requireStudentReadAccess(db, parent1User!, studentId)).resolves.toBeUndefined();
    await expect(requireStudentReadAccess(db, parent2User!, studentId)).resolves.toBeUndefined();

    const [relationship] = await db
      .select({ id: relationships.id })
      .from(relationships)
      .where(and(eq(relationships.parentId, parent1Id), eq(relationships.studentId, studentId)))
      .limit(1);

    await endRelationship(db, {
      actorId: parent1Id,
      relationshipId: relationship!.id,
      idempotencyKey: `end-${crypto.randomUUID()}`,
    });

    await expect(requireStudentReadAccess(db, parent1User!, studentId)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(requireStudentReadAccess(db, parent2User!, studentId)).resolves.toBeUndefined();

    const trends = await queryTrainingTrends(db, {
      studentId,
      trainingKey: REACTION_TRAINING_KEY,
      window: "all",
      referenceFamilyDate: "2026-08-31",
    });
    expect(trends.hasData).toBe(true);
  });
});
