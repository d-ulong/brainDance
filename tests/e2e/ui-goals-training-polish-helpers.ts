import { expect, type APIRequestContext } from "@playwright/test";

import { STROOP_COLORS } from "@/modules/training/constants";
import { getDigitSpanSchemaForAgeBand } from "@/modules/training/digit-span-v1";
import { getStroopSchemaForAgeBand } from "@/modules/training/stroop-v1";

import type { E2eFixture } from "./ui-helpers";

export type UiGoalsTrainingSeed = {
  formalPlanId: string;
  goalAssignmentId: string;
  goalContent: string;
  reactionSessionId: string;
  stroopSessionId: string;
  digitSpanSessionId: string;
};

export function shanghaiToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
}

export async function loginApi(
  request: APIRequestContext,
  identifier: string,
  password: string,
): Promise<void> {
  const response = await request.post("/api/auth/login", {
    data: {
      identifier,
      password,
      idempotencyKey: `polish-login-${identifier}-${Date.now()}`,
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

export async function logoutApi(request: APIRequestContext): Promise<void> {
  await request.post("/api/auth/session", {
    data: { idempotencyKey: `polish-logout-${Date.now()}` },
  });
}

async function appendReactionTrials(
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
        payload: { trialIndex, stimulusId: `polish-${trialIndex}` },
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

async function completeReactionViaApi(request: APIRequestContext): Promise<string> {
  const startResponse = await request.post("/api/training/sessions", {
    data: {
      trainingKey: "reaction",
      idempotencyKey: `polish-reaction-${Date.now()}`,
    },
  });
  expect(startResponse.ok()).toBeTruthy();
  const started = (await startResponse.json()) as { sessionId: string; expectedTrialCount: number };
  await appendReactionTrials(request, started.sessionId, started.expectedTrialCount);
  const submitResponse = await request.post(`/api/training/sessions/${started.sessionId}/submit`, {
    data: { idempotencyKey: `polish-reaction-submit-${Date.now()}` },
  });
  expect(submitResponse.ok()).toBeTruthy();
  const submitted = (await submitResponse.json()) as { status: string };
  expect(submitted.status).toBe("completed");
  return started.sessionId;
}

async function completeStroopViaApi(request: APIRequestContext): Promise<string> {
  const startResponse = await request.post("/api/training/sessions", {
    data: {
      trainingKey: "stroop",
      idempotencyKey: `polish-stroop-${Date.now()}`,
    },
  });
  expect(startResponse.ok()).toBeTruthy();
  const started = (await startResponse.json()) as {
    sessionId: string;
    ageBand: "5-8" | "9-12" | "13-18";
  };
  const schema = getStroopSchemaForAgeBand(started.ageBand);
  let sequence = 0;
  for (let trialIndex = 0; trialIndex < schema.trialCount; trialIndex += 1) {
    const inkColor = STROOP_COLORS[0]!;
    const wordColor = STROOP_COLORS[1]!;
    await request.post(`/api/training/sessions/${started.sessionId}/events`, {
      data: {
        sequence,
        eventType: "trial.stimulus",
        payload: { trialIndex, inkColor, wordColor, taskMode: "name_ink" },
      },
    });
    sequence += 1;
    await new Promise((resolve) => setTimeout(resolve, 220));
    await request.post(`/api/training/sessions/${started.sessionId}/events`, {
      data: {
        sequence,
        eventType: "trial.response",
        payload: { trialIndex, selectedColor: inkColor, inputMethod: "keyboard" },
      },
    });
    sequence += 1;
  }
  const submitResponse = await request.post(`/api/training/sessions/${started.sessionId}/submit`, {
    data: { idempotencyKey: `polish-stroop-submit-${Date.now()}` },
  });
  expect(submitResponse.ok()).toBeTruthy();
  return started.sessionId;
}

async function completeDigitSpanViaApi(request: APIRequestContext): Promise<string> {
  const startResponse = await request.post("/api/training/sessions", {
    data: {
      trainingKey: "digit-span",
      idempotencyKey: `polish-digit-${Date.now()}`,
    },
  });
  expect(startResponse.ok()).toBeTruthy();
  const started = (await startResponse.json()) as {
    sessionId: string;
    ageBand: "5-8" | "9-12" | "13-18";
  };
  const schema = getDigitSpanSchemaForAgeBand(started.ageBand);
  let sequence = 0;
  const attempts: Array<{
    mode: "forward" | "backward";
    length: number;
    attemptIndex: number;
    digits: number[];
  }> = [];
  for (let length = schema.forwardMinLength; length <= schema.forwardMaxLength; length += 1) {
    for (let attemptIndex = 0; attemptIndex < schema.attemptsPerLength; attemptIndex += 1) {
      attempts.push({
        mode: "forward",
        length,
        attemptIndex,
        digits: Array.from({ length }, (_, index) => index + 1),
      });
    }
  }
  for (let length = schema.backwardMinLength; length <= schema.backwardMaxLength; length += 1) {
    for (let attemptIndex = 0; attemptIndex < schema.attemptsPerLength; attemptIndex += 1) {
      attempts.push({
        mode: "backward",
        length,
        attemptIndex,
        digits: Array.from({ length }, (_, index) => index + 2),
      });
    }
  }
  for (const attempt of attempts) {
    await request.post(`/api/training/sessions/${started.sessionId}/events`, {
      data: {
        sequence,
        eventType: "span.stimulus",
        payload: {
          mode: attempt.mode,
          length: attempt.length,
          attemptIndex: attempt.attemptIndex,
          sequence: attempt.digits,
        },
      },
    });
    sequence += 1;
    const response = attempt.mode === "forward" ? attempt.digits : [...attempt.digits].reverse();
    await request.post(`/api/training/sessions/${started.sessionId}/events`, {
      data: {
        sequence,
        eventType: "span.response",
        payload: {
          mode: attempt.mode,
          length: attempt.length,
          attemptIndex: attempt.attemptIndex,
          sequence: attempt.digits,
          response,
        },
      },
    });
    sequence += 1;
  }
  const submitResponse = await request.post(`/api/training/sessions/${started.sessionId}/submit`, {
    data: { idempotencyKey: `polish-digit-submit-${Date.now()}` },
  });
  expect(submitResponse.ok()).toBeTruthy();
  return started.sessionId;
}

export async function seedUiGoalsTrainingPolish(
  request: APIRequestContext,
  fixture: E2eFixture,
): Promise<UiGoalsTrainingSeed> {
  const today = shanghaiToday();
  const runId = Date.now();

  await loginApi(request, fixture.parentEmail, fixture.parentPassword);
  const planResponse = await request.post(
    `/api/family/students/${fixture.studentId}/formal-plans`,
    {
      headers: { "Idempotency-Key": `polish-formal-${runId}` },
      data: {
        title: `Polish 正式计划 ${runId}`,
        localTime: "09:00",
        startDate: today,
      },
    },
  );
  let formalPlanId = "";
  if (planResponse.ok()) {
    formalPlanId = ((await planResponse.json()) as { planId: string }).planId;
  } else {
    const planError = await planResponse.text();
    expect(planError).toContain("Active formal plan already exists");
  }

  const pointRuleResponse = await request.post(
    `/api/family/students/${fixture.studentId}/point-rules`,
    {
      headers: { "Idempotency-Key": `polish-points-${runId}` },
      data: { templateId: "schedule_system_complete_v1" },
    },
  );
  if (!pointRuleResponse.ok()) {
    const pointRuleError = await pointRuleResponse.text();
    expect(
      pointRuleError.includes("already") || pointRuleError.includes("exists"),
      pointRuleError,
    ).toBeTruthy();
  }

  const horizonResponse = await request.post(
    `/api/family/students/${fixture.studentId}/formal-plans/maintain-horizon`,
    {
      headers: { "Idempotency-Key": `polish-horizon-${runId}` },
    },
  );
  expect(horizonResponse.ok(), await horizonResponse.text()).toBeTruthy();

  const itemsResponse = await request.get(
    `/api/family/students/${fixture.studentId}/schedule-items?from=${today}&to=${today}`,
  );
  expect(itemsResponse.ok(), await itemsResponse.text()).toBeTruthy();
  const itemsBody = (await itemsResponse.json()) as { items: unknown[] };
  expect(itemsBody.items.length).toBeGreaterThan(0);

  await logoutApi(request);
  await loginApi(request, fixture.studentUsername, fixture.studentPassword);
  const libraryResponse = await request.post("/api/plan-library", {
    headers: { "Idempotency-Key": `polish-library-${runId}` },
    data: {
      priority: 0,
      definition: {
        title: `Polish 自主计划 ${runId}`,
        startDate: today,
        entries: [
          {
            key: `polish-library-task-${runId}`,
            title: "Polish 自主任务",
            expectedTime: "10:00",
            repeat: { kind: "daily" },
            points: {
              onTimeWithin: 0,
              onTimeOver: 0,
              lateWithin: 0,
              lateOver: 0,
              incomplete: 0,
            },
          },
        ],
      },
    },
  });
  expect(libraryResponse.ok(), await libraryResponse.text()).toBeTruthy();
  const libraryBody = (await libraryResponse.json()) as { plan: { id: string } };
  const libraryActivate = await request.post(`/api/plan-library/${libraryBody.plan.id}/activate`, {
    headers: { "Idempotency-Key": `polish-library-activate-${runId}` },
    data: { studentId: fixture.studentId, effectiveFrom: today },
  });
  expect(libraryActivate.ok(), await libraryActivate.text()).toBeTruthy();

  const reactionSessionId = await completeReactionViaApi(request);
  const stroopSessionId = await completeStroopViaApi(request);
  const digitSpanSessionId = await completeDigitSpanViaApi(request);

  await logoutApi(request);

  await loginApi(request, fixture.parentEmail, fixture.parentPassword);
  const goalContent = `Polish 目标 ${runId}`;
  const goalResponse = await request.post("/api/goals", {
    headers: { "Idempotency-Key": `polish-goal-${runId}` },
    data: {
      subjectIds: [fixture.studentId],
      content: goalContent,
      dueDate: "2026-12-31",
      horizon: "medium",
      expectedPoints: 5,
    },
  });
  expect(goalResponse.ok(), await goalResponse.text()).toBeTruthy();
  const goalBody = (await goalResponse.json()) as { assignmentIds: string[] };
  await logoutApi(request);

  return {
    formalPlanId,
    goalAssignmentId: goalBody.assignmentIds[0]!,
    goalContent,
    reactionSessionId,
    stroopSessionId,
    digitSpanSessionId,
  };
}
