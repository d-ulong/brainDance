import { config } from "dotenv";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import "./helpers/auth-mock";
import { clearMockSessionCookie } from "./helpers/auth-mock";
import { bootstrapLinkedParentStudent, withSessionCookie } from "./helpers/session";
import { POST as startTrainingRoute } from "@/app/api/training/sessions/route";
import { GET as getTrainingSessionRoute } from "@/app/api/training/sessions/[sessionId]/route";
import { POST as appendTrainingEventRoute } from "@/app/api/training/sessions/[sessionId]/events/route";
import { POST as submitTrainingRoute } from "@/app/api/training/sessions/[sessionId]/submit/route";
import { bootstrapAdmin } from "../../helpers/identity";
import { REACTION_TRAINING_KEY } from "@/modules/training/constants";
import { ensureM5TrainingDefinitions } from "../../helpers/training";
import { closeTestDb, getTestDb, migrateTestDb, resetIdentityTables } from "../../helpers/db";

config({ path: ".env.local" });
config({ path: ".env" });

const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("P2 training API subject boundary", () => {
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

  it("lets authenticated parent use training API without owner id in body", async () => {
    const linked = await bootstrapLinkedParentStudent(db);
    withSessionCookie(linked.parentSession);

    const startResponse = await startTrainingRoute(
      new Request("http://localhost/api/training/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          trainingKey: REACTION_TRAINING_KEY,
          idempotencyKey: "api-parent-start",
        }),
      }),
    );
    expect(startResponse.status).toBe(200);
    const started = await startResponse.json();
    expect(started.ageBand).toBe("adult");
    expect(started.sessionId).toBeTruthy();

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
        body: JSON.stringify({ idempotencyKey: "api-parent-submit" }),
      }),
      { params: Promise.resolve({ sessionId: started.sessionId }) },
    );
    expect(submitResponse.status).toBe(200);
    const submitted = await submitResponse.json();
    expect(submitted.status).toBe("completed");

    const readResponse = await getTrainingSessionRoute(
      new Request(`http://localhost/api/training/sessions/${started.sessionId}`),
      { params: Promise.resolve({ sessionId: started.sessionId }) },
    );
    expect(readResponse.status).toBe(200);
    const detail = await readResponse.json();
    expect(detail.ageBand).toBe("adult");
  });

  it("keeps student training API behavior and rejects admin", async () => {
    const linked = await bootstrapLinkedParentStudent(db);
    withSessionCookie(linked.studentSession);

    const studentStart = await startTrainingRoute(
      new Request("http://localhost/api/training/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          trainingKey: REACTION_TRAINING_KEY,
          idempotencyKey: "api-student-start",
        }),
      }),
    );
    expect(studentStart.status).toBe(200);
    const started = await studentStart.json();
    expect(started.ageBand).not.toBe("adult");

    const admin = await bootstrapAdmin(
      db,
      `admin_p2_${crypto.randomUUID().slice(0, 8)}@test.local`,
    );
    withSessionCookie(admin.session);

    const adminStart = await startTrainingRoute(
      new Request("http://localhost/api/training/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          trainingKey: REACTION_TRAINING_KEY,
          idempotencyKey: "api-admin-start",
        }),
      }),
    );
    expect(adminStart.status).toBe(403);
  });
});
