import { and, eq } from "drizzle-orm";
import { config } from "dotenv";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import "../api/helpers/auth-mock";
import { clearMockSessionCookie } from "../api/helpers/auth-mock";
import { bootstrapLinkedParentStudent, withSessionCookie } from "../api/helpers/session";
import { GET as getFamilyStudentTrainingSessionRoute } from "@/app/api/family/students/[studentId]/training/sessions/[sessionId]/route";
import { GET as getTrainingSessionRoute } from "@/app/api/training/sessions/[sessionId]/route";
import { POST as startTrainingRoute } from "@/app/api/training/sessions/route";
import { relationships } from "@/db/schema";
import { endRelationship } from "@/modules/family-access/end-relationship.service";
import { login } from "@/modules/identity/login.service";
import { REACTION_TRAINING_KEY } from "@/modules/training/constants";
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
  submitTrainingSessionForSubject,
} from "@/modules/training/session.service";
import { resolveTrainingSubject } from "@/modules/training/training-subject";
import { closeTestDb, getTestDb, migrateTestDb, resetIdentityTables } from "../../helpers/db";

config({ path: ".env.local" });
config({ path: ".env" });

const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);

function familySessionRequest(studentId: string, sessionId: string) {
  return new Request(
    `http://localhost/api/family/students/${studentId}/training/sessions/${sessionId}`,
    { method: "GET" },
  );
}

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

  it("withholds review for active, cancelled and protocol-invalid sessions", async () => {
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

    const invalidStarted = await startTrainingSessionForSubject(db, {
      subject,
      trainingKey: REACTION_TRAINING_KEY,
      idempotencyKey: `invalid-${crypto.randomUUID()}`,
    });
    const invalidSubmitted = await submitTrainingSessionForSubject(db, {
      subject,
      sessionId: invalidStarted.sessionId,
      idempotencyKey: `invalid-submit-${crypto.randomUUID()}`,
    });
    expect(invalidSubmitted.status).toBe("invalid");
    const invalidDetail = await getTrainingSessionForSubject(db, subject, invalidStarted.sessionId);
    expect(invalidDetail.status).toBe("invalid");
    expect(invalidDetail.trialReview).toBeNull();
  });

  it("returns review to authorized parent via family route and blocks other readers", async () => {
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

    withSessionCookie(linked.parentSession);
    const allowedChildSession = await getFamilyStudentTrainingSessionRoute(
      familySessionRequest(linked.studentId, reaction.started.sessionId),
      {
        params: Promise.resolve({
          studentId: linked.studentId,
          sessionId: reaction.started.sessionId,
        }),
      },
    );
    expect(allowedChildSession.status).toBe(200);
    const childPayload = await allowedChildSession.json();
    expect(childPayload.trialReview?.[0]?.kind).toBe("reaction");
    expect(JSON.stringify(childPayload)).not.toContain('"payload"');

    withSessionCookie(other.parentSession);
    const deniedOtherParent = await getTrainingSessionRoute(
      new Request(`http://localhost/api/training/sessions/${parentSession.sessionId}`),
      { params: Promise.resolve({ sessionId: parentSession.sessionId }) },
    );
    expect(deniedOtherParent.status).toBeGreaterThanOrEqual(400);

    withSessionCookie(other.parentSession);
    const deniedOtherChild = await getFamilyStudentTrainingSessionRoute(
      familySessionRequest(linked.studentId, reaction.started.sessionId),
      {
        params: Promise.resolve({
          studentId: linked.studentId,
          sessionId: reaction.started.sessionId,
        }),
      },
    );
    expect(deniedOtherChild.status).toBe(403);
  });

  it("blocks revoked parent from child session detail at request time", async () => {
    const linked = await bootstrapLinkedParentStudent(db);
    const reaction = await completeReactionSession(db, linked.studentId);

    const [relationship] = await db
      .select({ id: relationships.id })
      .from(relationships)
      .where(
        and(
          eq(relationships.parentId, linked.parentId),
          eq(relationships.studentId, linked.studentId),
        ),
      )
      .limit(1);

    await endRelationship(db, {
      actorId: linked.parentId,
      relationshipId: relationship!.id,
      idempotencyKey: `review-end-${crypto.randomUUID()}`,
    });

    const refreshedParentSession = await login(db, {
      identifier: linked.parentEmail,
      password: "Parent1aXy",
      idempotencyKey: `review-end-login-${crypto.randomUUID()}`,
    });
    withSessionCookie(refreshedParentSession);

    const response = await getFamilyStudentTrainingSessionRoute(
      familySessionRequest(linked.studentId, reaction.started.sessionId),
      {
        params: Promise.resolve({
          studentId: linked.studentId,
          sessionId: reaction.started.sessionId,
        }),
      },
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "FORBIDDEN" },
    });
  });
});
