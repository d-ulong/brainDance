import { config } from "dotenv";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import "./helpers/auth-mock";
import { clearMockSessionCookie } from "./helpers/auth-mock";
import { bootstrapLinkedParentStudent, withSessionCookie } from "./helpers/session";
import { POST as startTrainingRoute } from "@/app/api/training/sessions/route";
import { GET as getTrainingSessionRoute } from "@/app/api/training/sessions/[sessionId]/route";
import { POST as appendTrainingEventRoute } from "@/app/api/training/sessions/[sessionId]/events/route";
import { POST as submitTrainingRoute } from "@/app/api/training/sessions/[sessionId]/submit/route";
import { GET as getOwnTrainingSummaryRoute } from "@/app/api/training/summary/route";
import { GET as getOwnTrainingTrendsRoute } from "@/app/api/training/trends/route";
import { REACTION_TRAINING_KEY } from "@/modules/training/constants";
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
});
