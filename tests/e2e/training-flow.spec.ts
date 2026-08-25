import { readFileSync } from "node:fs";
import path from "node:path";

import { expect, test, type APIRequestContext } from "@playwright/test";

type Fixture = {
  parentEmail: string;
  parentPassword: string;
  studentUsername: string;
  studentPassword: string;
  studentId: string;
};

function loadFixture(): Fixture {
  const fixturePath = path.join(process.cwd(), "tests/e2e/.fixture.json");
  return JSON.parse(readFileSync(fixturePath, "utf8")) as Fixture;
}

async function login(request: APIRequestContext, identifier: string, password: string) {
  const response = await request.post("/api/auth/login", {
    data: {
      identifier,
      password,
      idempotencyKey: `login-${identifier}-${Date.now()}`,
    },
  });
  expect(response.ok()).toBeTruthy();
}

async function appendTrialEvents(
  request: APIRequestContext,
  sessionId: string,
  trialCount: number,
) {
  let sequence = 0;
  for (let trialIndex = 0; trialIndex < trialCount; trialIndex += 1) {
    const stimulusResponse = await request.post(`/api/training/sessions/${sessionId}/events`, {
      data: {
        sequence,
        eventType: "trial.stimulus",
        payload: { trialIndex, stimulusId: `s-${trialIndex}` },
      },
    });
    expect(stimulusResponse.ok()).toBeTruthy();
    sequence += 1;

    await new Promise((resolve) => setTimeout(resolve, 220));

    const responseEvent = await request.post(`/api/training/sessions/${sessionId}/events`, {
      data: {
        sequence,
        eventType: "trial.response",
        payload: { trialIndex, correct: true, inputMethod: "keyboard" },
      },
    });
    expect(responseEvent.ok()).toBeTruthy();
    sequence += 1;
  }
}

test.describe("training acceptance", () => {
  test("student results survive refresh and parent can read summary after re-login", async ({
    request,
  }) => {
    const fixture = loadFixture();

    await login(request, fixture.studentUsername, fixture.studentPassword);

    const startResponse = await request.post("/api/training/sessions", {
      data: {
        trainingKey: "reaction",
        idempotencyKey: `e2e-start-${Date.now()}`,
      },
    });
    expect(startResponse.ok()).toBeTruthy();
    const started = (await startResponse.json()) as { sessionId: string };

    await appendTrialEvents(request, started.sessionId, 5);

    const submitResponse = await request.post(`/api/training/sessions/${started.sessionId}/submit`, {
      data: { idempotencyKey: `e2e-submit-${Date.now()}` },
    });
    expect(submitResponse.ok()).toBeTruthy();
    const submitted = (await submitResponse.json()) as {
      status: string;
      sessionKind: string;
      metrics: Array<{ metricKey: string; value: number }>;
    };
    expect(submitted.status).toBe("completed");
    expect(submitted.sessionKind).toBe("effective");
    expect(submitted.metrics.some((m) => m.metricKey === "median_reaction_ms")).toBe(true);

    const firstRead = await request.get(`/api/training/sessions/${started.sessionId}`);
    expect(firstRead.ok()).toBeTruthy();
    const firstBody = (await firstRead.json()) as {
      metrics: Array<{ metricKey: string; value: number }>;
    };

    const secondRead = await request.get(`/api/training/sessions/${started.sessionId}`);
    expect(secondRead.ok()).toBeTruthy();
    const secondBody = (await secondRead.json()) as {
      metrics: Array<{ metricKey: string; value: number }>;
    };

    expect(secondBody.metrics).toEqual(firstBody.metrics);

    await request.post("/api/auth/session", {
      data: { idempotencyKey: `logout-student-${Date.now()}` },
    });

    await login(request, fixture.parentEmail, fixture.parentPassword);

    const summaryResponse = await request.get(
      `/api/students/${fixture.studentId}/training-summary?trainingKey=reaction`,
    );
    expect(summaryResponse.ok()).toBeTruthy();
    const summary = (await summaryResponse.json()) as {
      lastSession: { sessionId: string; metrics: Array<{ metricKey: string }> } | null;
    };
    expect(summary.lastSession?.sessionId).toBe(started.sessionId);
    expect(summary.lastSession?.metrics.some((m) => m.metricKey === "accuracy")).toBe(true);
  });
});
