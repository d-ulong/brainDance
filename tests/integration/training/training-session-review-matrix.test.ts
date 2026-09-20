import { config } from "dotenv";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import "../api/helpers/auth-mock";
import { clearMockSessionCookie } from "../api/helpers/auth-mock";
import { bootstrapLinkedParentStudent, withSessionCookie } from "../api/helpers/session";
import { GET as getTrainingSessionRoute } from "@/app/api/training/sessions/[sessionId]/route";
import { POST as startTrainingRoute } from "@/app/api/training/sessions/route";
import {
  completeDigitSpanSession,
  completeReactionSession,
  completeStroopSession,
  ensureM5TrainingDefinitions,
} from "../../helpers/training";
import {
  cancelTrainingSessionForSubject,
  getTrainingSessionForSubject,
  startTrainingSessionForSubject,
} from "@/modules/training/session.service";
import { resolveTrainingSubject } from "@/modules/training/training-subject";
import { REACTION_TRAINING_KEY } from "@/modules/training/constants";
import { closeTestDb, getTestDb, migrateTestDb, resetIdentityTables } from "../../helpers/db";

config({ path: ".env.local" });
config({ path: ".env" });

const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("training session trial review matrix", () => {
  const db = getTestDb();

  beforeAll(async () => {
    process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";
    await migrateTestDb();
  });

  beforeEach(async () => {
    clearMockSessionCookie();
    await resetIdentityTables(db);
    await ensureM5TrainingDefinitions(db);
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("builds reaction, stroop and digit-span reviews without raw payloads", async () => {
    const linked = await bootstrapLinkedParentStudent(db);
    const subject = await resolveTrainingSubject(db, linked.studentId);

    const reaction = await completeReactionSession(db, linked.studentId);
    const stroop = await completeStroopSession(db, linked.studentId);
    const digit = await completeDigitSpanSession(db, linked.studentId);

    for (const [sessionId, kind] of [
      [reaction.started.sessionId, "reaction"],
      [stroop.started.sessionId, "stroop"],
      [digit.started.sessionId, "digit-span"],
    ] as const) {
      const detail = await getTrainingSessionForSubject(db, subject, sessionId);
      expect(detail.status).toBe("completed");
      expect(detail.trialReview?.[0]?.kind).toBe(kind);
      expect(JSON.stringify(detail)).not.toContain("stimulusId");
      expect(JSON.stringify(detail)).not.toContain('"payload"');
    }
  });

  it("withholds review for active and abandoned sessions", async () => {
    const linked = await bootstrapLinkedParentStudent(db);
    const subject = await resolveTrainingSubject(db, linked.studentId);
    const started = await startTrainingSessionForSubject(db, {
      subject,
      trainingKey: REACTION_TRAINING_KEY,
      idempotencyKey: `active-${crypto.randomUUID()}`,
    });
    const active = await getTrainingSessionForSubject(db, subject, started.sessionId);
    expect(active.status).toBe("active");
    expect(active.trialReview).toBeNull();

    await cancelTrainingSessionForSubject(db, {
      subject,
      sessionId: started.sessionId,
    });
    const abandoned = await getTrainingSessionForSubject(db, subject, started.sessionId);
    expect(abandoned.status).toBe("cancelled");
    expect(abandoned.trialReview).toBeNull();
  });

  it("returns review to authorized parent for own session and blocks other readers", async () => {
    const linked = await bootstrapLinkedParentStudent(db);
    const other = await bootstrapLinkedParentStudent(db);
    const reaction = await completeReactionSession(db, linked.studentId);

    withSessionCookie(linked.parentSession);
    const parentOwnStart = await startTrainingRoute(
      new Request("http://localhost/api/training/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          trainingKey: REACTION_TRAINING_KEY,
          idempotencyKey: "parent-readable",
        }),
      }),
    );
    expect(parentOwnStart.status).toBe(200);
    const parentSession = await parentOwnStart.json();

    withSessionCookie(linked.parentSession);
    const deniedStudentSession = await getTrainingSessionRoute(
      new Request(`http://localhost/api/training/sessions/${reaction.started.sessionId}`),
      { params: Promise.resolve({ sessionId: reaction.started.sessionId }) },
    );
    expect(deniedStudentSession.status).toBeGreaterThanOrEqual(400);

    withSessionCookie(other.parentSession);
    const deniedOtherParent = await getTrainingSessionRoute(
      new Request(`http://localhost/api/training/sessions/${parentSession.sessionId}`),
      { params: Promise.resolve({ sessionId: parentSession.sessionId }) },
    );
    expect(deniedOtherParent.status).toBeGreaterThanOrEqual(400);
  });
});
