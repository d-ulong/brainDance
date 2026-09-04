import { config } from "dotenv";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import "./helpers/auth-mock";
import { clearMockSessionCookie } from "./helpers/auth-mock";
import { bootstrapLinkedParentStudent, withSessionCookie } from "./helpers/session";
import { POST as startTrainingRoute } from "@/app/api/training/sessions/route";
import { GET as getTrainingSessionRoute } from "@/app/api/training/sessions/[sessionId]/route";
import { POST as appendTrainingEventRoute } from "@/app/api/training/sessions/[sessionId]/events/route";
import { POST as submitTrainingRoute } from "@/app/api/training/sessions/[sessionId]/submit/route";
import { POST as terminateTrainingRoute } from "@/app/api/training/sessions/[sessionId]/terminate/route";
import { GET as getOwnTrainingSummaryRoute } from "@/app/api/training/summary/route";
import { GET as getOwnTrainingTrendsRoute } from "@/app/api/training/trends/route";
import { createInvitation } from "@/modules/identity/invitation.service";
import { login } from "@/modules/identity/login.service";
import { registerParent } from "@/modules/identity/registration.service";
import { REACTION_TRAINING_KEY } from "@/modules/training/constants";
import { bootstrapAdmin } from "../../helpers/identity";
import { ensureM5TrainingDefinitions } from "../../helpers/training";
import { closeTestDb, getTestDb, migrateTestDb, resetIdentityTables } from "../../helpers/db";

config({ path: ".env.local" });
config({ path: ".env" });

const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);

async function completeParentReactionSession(idempotencyPrefix: string) {
  const startResponse = await startTrainingRoute(
    new Request("http://localhost/api/training/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        trainingKey: REACTION_TRAINING_KEY,
        idempotencyKey: `${idempotencyPrefix}-start`,
      }),
    }),
  );
  expect(startResponse.status).toBe(200);
  const started = await startResponse.json();

  let sequence = 0;
  for (let trialIndex = 0; trialIndex < 5; trialIndex += 1) {
    const stimulus = await appendTrainingEventRoute(
      new Request(`http://localhost/api/training/sessions/${started.sessionId}/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sequence,
          eventType: "trial.stimulus",
          payload: { trialIndex, stimulusId: `s-${trialIndex}` },
        }),
      }),
      { params: Promise.resolve({ sessionId: started.sessionId }) },
    );
    expect(stimulus.status).toBe(200);
    sequence += 1;

    await new Promise((resolve) => setTimeout(resolve, 15));

    const responseEvent = await appendTrainingEventRoute(
      new Request(`http://localhost/api/training/sessions/${started.sessionId}/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sequence,
          eventType: "trial.response",
          payload: { trialIndex, correct: true, inputMethod: "keyboard" },
        }),
      }),
      { params: Promise.resolve({ sessionId: started.sessionId }) },
    );
    expect(responseEvent.status).toBe(200);
    sequence += 1;
  }

  const submitResponse = await submitTrainingRoute(
    new Request(`http://localhost/api/training/sessions/${started.sessionId}/submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idempotencyKey: `${idempotencyPrefix}-submit` }),
    }),
    { params: Promise.resolve({ sessionId: started.sessionId }) },
  );
  expect(submitResponse.status).toBe(200);

  return started as { sessionId: string; ageBand: string };
}

describe.skipIf(!hasDb)("parent self training summary/trends routes", () => {
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

  it("returns only the authenticated parent traineeId and rejects other parent/student", async () => {
    const owner = await bootstrapLinkedParentStudent(db);
    const other = await bootstrapLinkedParentStudent(db);

    withSessionCookie(owner.parentSession);
    const started = await completeParentReactionSession("parent-self-owner");
    expect(started.ageBand).toBe("adult");

    const summaryResponse = await getOwnTrainingSummaryRoute(
      new Request(`http://localhost/api/training/summary?trainingKey=${REACTION_TRAINING_KEY}`),
    );
    expect(summaryResponse.status).toBe(200);
    const summary = await summaryResponse.json();
    expect(summary.traineeId).toBe(owner.parentId);
    expect(summary.studentId).toBeUndefined();
    expect(summary.ageBand).toBe("adult");
    expect(summary.lastSession?.sessionId).toBe(started.sessionId);

    const trendsResponse = await getOwnTrainingTrendsRoute(
      new Request(
        `http://localhost/api/training/trends?trainingKey=${REACTION_TRAINING_KEY}&window=7d`,
      ),
    );
    expect(trendsResponse.status).toBe(200);
    const trends = await trendsResponse.json();
    expect(trends.traineeId).toBe(owner.parentId);
    expect(trends.studentId).toBeUndefined();
    expect(trends.hasData).toBe(true);
    expect(
      trends.segments.some((segment: { ageBand: string }) => segment.ageBand === "adult"),
    ).toBe(true);

    withSessionCookie(other.parentSession);
    const otherSessionRead = await getTrainingSessionRoute(
      new Request(`http://localhost/api/training/sessions/${started.sessionId}`),
      { params: Promise.resolve({ sessionId: started.sessionId }) },
    );
    expect(otherSessionRead.status).toBeGreaterThanOrEqual(400);

    const otherTrends = await getOwnTrainingTrendsRoute(
      new Request(
        `http://localhost/api/training/trends?trainingKey=${REACTION_TRAINING_KEY}&window=7d`,
      ),
    );
    expect(otherTrends.status).toBe(200);
    const otherTrendsBody = await otherTrends.json();
    expect(otherTrendsBody.traineeId).toBe(other.parentId);
    expect(otherTrendsBody.hasData).toBe(false);

    withSessionCookie(owner.studentSession);
    const studentSessionRead = await getTrainingSessionRoute(
      new Request(`http://localhost/api/training/sessions/${started.sessionId}`),
      { params: Promise.resolve({ sessionId: started.sessionId }) },
    );
    expect(studentSessionRead.status).toBeGreaterThanOrEqual(400);

    const studentTrends = await getOwnTrainingTrendsRoute(
      new Request(
        `http://localhost/api/training/trends?trainingKey=${REACTION_TRAINING_KEY}&window=7d`,
      ),
    );
    expect(studentTrends.status).toBe(200);
    const studentTrendsBody = await studentTrends.json();
    expect(studentTrendsBody.traineeId).toBe(owner.studentId);
    expect(studentTrendsBody.hasData).toBe(false);
  });

  it("rejects unverified parent on trainee training routes and allows verified parent", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const { adminId } = await bootstrapAdmin(db, `admin-unverified-${suffix}@test.local`);
    const parentEmail = `unverified-parent-${suffix}@test.local`;
    const invite = await createInvitation(db, {
      adminId,
      targetRole: "parent",
      idempotencyKey: `invite-unverified-${suffix}`,
    });
    await registerParent(db, {
      invitationCode: invite.codePlaintext,
      displayName: "Unverified Parent",
      email: parentEmail,
      password: "Parent1aXy",
      idempotencyKey: `register-unverified-${suffix}`,
    });
    const unverifiedSession = await login(db, {
      identifier: parentEmail,
      password: "Parent1aXy",
      idempotencyKey: `login-unverified-${suffix}`,
    });

    withSessionCookie(unverifiedSession);
    const placeholderSessionId = crypto.randomUUID();

    const startDenied = await startTrainingRoute(
      new Request("http://localhost/api/training/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          trainingKey: REACTION_TRAINING_KEY,
          idempotencyKey: `unverified-start-${suffix}`,
        }),
      }),
    );
    expect(startDenied.status).toBe(403);
    expect((await startDenied.json()).code).toBe("CONTACT_NOT_VERIFIED");

    const eventDenied = await appendTrainingEventRoute(
      new Request(`http://localhost/api/training/sessions/${placeholderSessionId}/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sequence: 0,
          eventType: "trial.stimulus",
          payload: { trialIndex: 0, stimulusId: "s-0" },
        }),
      }),
      { params: Promise.resolve({ sessionId: placeholderSessionId }) },
    );
    expect(eventDenied.status).toBe(403);
    expect((await eventDenied.json()).code).toBe("CONTACT_NOT_VERIFIED");

    const submitDenied = await submitTrainingRoute(
      new Request(`http://localhost/api/training/sessions/${placeholderSessionId}/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idempotencyKey: `unverified-submit-${suffix}` }),
      }),
      { params: Promise.resolve({ sessionId: placeholderSessionId }) },
    );
    expect(submitDenied.status).toBe(403);
    expect((await submitDenied.json()).code).toBe("CONTACT_NOT_VERIFIED");

    const terminateDenied = await terminateTrainingRoute(
      new Request(`http://localhost/api/training/sessions/${placeholderSessionId}/terminate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "abandon",
          reason: "unverified-parent-guard",
        }),
      }),
      { params: Promise.resolve({ sessionId: placeholderSessionId }) },
    );
    expect(terminateDenied.status).toBe(403);
    expect((await terminateDenied.json()).code).toBe("CONTACT_NOT_VERIFIED");

    const sessionReadDenied = await getTrainingSessionRoute(
      new Request(`http://localhost/api/training/sessions/${placeholderSessionId}`),
      { params: Promise.resolve({ sessionId: placeholderSessionId }) },
    );
    expect(sessionReadDenied.status).toBe(403);
    expect((await sessionReadDenied.json()).code).toBe("CONTACT_NOT_VERIFIED");

    const summaryDenied = await getOwnTrainingSummaryRoute(
      new Request(`http://localhost/api/training/summary?trainingKey=${REACTION_TRAINING_KEY}`),
    );
    expect(summaryDenied.status).toBe(403);
    expect((await summaryDenied.json()).code).toBe("CONTACT_NOT_VERIFIED");

    const trendsDenied = await getOwnTrainingTrendsRoute(
      new Request(
        `http://localhost/api/training/trends?trainingKey=${REACTION_TRAINING_KEY}&window=7d`,
      ),
    );
    expect(trendsDenied.status).toBe(403);
    expect((await trendsDenied.json()).code).toBe("CONTACT_NOT_VERIFIED");

    const verified = await bootstrapLinkedParentStudent(db);
    withSessionCookie(verified.parentSession);

    const emptySummary = await getOwnTrainingSummaryRoute(
      new Request(`http://localhost/api/training/summary?trainingKey=${REACTION_TRAINING_KEY}`),
    );
    expect(emptySummary.status).toBe(200);
    const emptySummaryBody = await emptySummary.json();
    expect(emptySummaryBody.traineeId).toBe(verified.parentId);
    expect(emptySummaryBody.ageBand).toBe("adult");
    expect(emptySummaryBody.lastSession).toBeNull();

    const started = await completeParentReactionSession(`verified-ok-${suffix}`);
    expect(started.ageBand).toBe("adult");

    const sessionReadOk = await getTrainingSessionRoute(
      new Request(`http://localhost/api/training/sessions/${started.sessionId}`),
      { params: Promise.resolve({ sessionId: started.sessionId }) },
    );
    expect(sessionReadOk.status).toBe(200);

    const summaryOk = await getOwnTrainingSummaryRoute(
      new Request(`http://localhost/api/training/summary?trainingKey=${REACTION_TRAINING_KEY}`),
    );
    expect(summaryOk.status).toBe(200);
    expect((await summaryOk.json()).ageBand).toBe("adult");

    const trendsOk = await getOwnTrainingTrendsRoute(
      new Request(
        `http://localhost/api/training/trends?trainingKey=${REACTION_TRAINING_KEY}&window=7d`,
      ),
    );
    expect(trendsOk.status).toBe(200);
    expect((await trendsOk.json()).traineeId).toBe(verified.parentId);

    withSessionCookie(verified.studentSession);
    const studentEmptySummary = await getOwnTrainingSummaryRoute(
      new Request(`http://localhost/api/training/summary?trainingKey=${REACTION_TRAINING_KEY}`),
    );
    expect(studentEmptySummary.status).toBe(200);
    const studentEmptyBody = await studentEmptySummary.json();
    expect(studentEmptyBody.traineeId).toBe(verified.studentId);
    expect(studentEmptyBody.ageBand).not.toBe("adult");
    expect(["5-8", "9-12", "13-18"]).toContain(studentEmptyBody.ageBand);
  });
});
