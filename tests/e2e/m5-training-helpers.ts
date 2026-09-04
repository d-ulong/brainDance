import { expect, type APIRequestContext, type Page } from "@playwright/test";

import {
  buildDigitSpanAttemptPlan,
  responseDigitsForAttempt,
} from "@/components/training/digit-span-plan";
import { STROOP_COLORS } from "@/modules/training/constants";

import type { E2eFixture } from "./ui-helpers";

export async function assertNoHorizontalScroll(page: Page) {
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
}

async function loginApi(request: APIRequestContext, identifier: string, password: string) {
  const response = await request.post("/api/auth/login", {
    data: {
      identifier,
      password,
      idempotencyKey: `login-${identifier}-${Date.now()}`,
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

export async function waitForReactionReady(page: Page) {
  const target = page.getByTestId("training-target");
  await expect(target).toContainText("Space / Enter", { timeout: 15_000 });
  await expect(target).toBeEnabled({ timeout: 15_000 });
  await page.waitForTimeout(120);
  return target;
}

export async function completeReactionTraining(
  page: Page,
  inputMethod: "pointer" | "keyboard" = "pointer",
  hubBase: "/student/training" | "/parent/training" = "/student/training",
) {
  await page.goto(`${hubBase}/reaction`);
  await expect(page.getByTestId("training-target")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("training-disclaimer")).toBeVisible();

  for (let trial = 0; trial < 5; trial += 1) {
    const target = await waitForReactionReady(page);
    const eventResponse = page.waitForResponse(
      (resp) =>
        resp.url().includes("/api/training/sessions/") &&
        resp.url().includes("/events") &&
        resp.request().method() === "POST" &&
        (resp.request().postDataJSON() as { eventType?: string } | null)?.eventType ===
          "trial.response",
    );
    if (inputMethod === "pointer") {
      await target.click();
    } else {
      await page.keyboard.press("Space");
    }
    await eventResponse;
    if (trial < 4) {
      await expect(page.getByText(new RegExp(`${trial + 2}\\s*/\\s*5`))).toBeVisible({
        timeout: 20_000,
      });
    }
  }

  await expect(page).toHaveURL(new RegExp(`${hubBase}/[^/]+$`), { timeout: 30_000 });
  await expect(page.getByTestId("session-status")).toHaveText("completed", { timeout: 30_000 });
  await expect(page.getByTestId("metric-median_reaction_ms")).toBeVisible();
}

export async function respondToStroopTrial(
  page: Page,
  selectInkColor: boolean,
  inputMethod: "pointer" | "keyboard" = "keyboard",
) {
  const stimulus = page.getByTestId("stroop-stimulus");
  await expect(stimulus).toBeVisible({ timeout: 15_000 });
  const inkColor = await stimulus.getAttribute("data-ink-color");
  expect(inkColor).toBeTruthy();

  const targetColor = selectInkColor
    ? inkColor!
    : STROOP_COLORS.find((color) => color !== inkColor)!;

  const option = page.getByTestId(`stroop-option-${targetColor}`);
  await expect(option).toBeEnabled({ timeout: 10_000 });
  await page.waitForTimeout(180);
  const responseWait = page.waitForResponse(
    (resp) =>
      resp.url().includes("/events") &&
      resp.request().method() === "POST" &&
      (resp.request().postDataJSON() as { eventType?: string } | null)?.eventType ===
        "trial.response",
  );
  if (inputMethod === "pointer") {
    await option.click();
  } else {
    await option.focus();
    await page.keyboard.press("Enter");
  }
  await responseWait;
}

export async function completeStroopTraining(page: Page) {
  await page.goto("/student/training/stroop");
  await expect(page.getByTestId("stroop-stimulus")).toBeVisible({ timeout: 30_000 });

  const totalText = await page.getByText(/\/ \d+ ?/).innerText();
  const match = totalText.match(/\/ (\d+) ?/);
  const total = match ? Number(match[1]) : 16;

  for (let trial = 0; trial < total; trial += 1) {
    await respondToStroopTrial(page, true, "pointer");
    if (trial < total - 1) {
      await expect(page.getByText(`? ${trial + 2} / ${total} ?`)).toBeVisible({
        timeout: 20_000,
      });
    }
  }

  await expect(page.getByTestId("session-status")).toHaveText("completed", { timeout: 60_000 });
  await expect(page.getByTestId("metric-interference_delta")).toBeVisible();
}

async function readDigitSpanAttemptMeta(page: Page) {
  const section = page.locator("[data-mode][data-length][data-attempt-index]").first();
  await expect(section).toBeVisible({ timeout: 15_000 });
  const mode = (await section.getAttribute("data-mode")) as "forward" | "backward";
  const length = Number(await section.getAttribute("data-length"));
  const attemptIndex = Number(await section.getAttribute("data-attempt-index"));
  return { mode, length, attemptIndex };
}

export async function waitForDigitSpanResponsePhase(page: Page) {
  await expect(page.getByTestId("digit-stimulus")).toBeHidden({ timeout: 20_000 });
  await expect(page.getByTestId("digit-response")).toHaveAttribute("data-ready", "true", {
    timeout: 20_000,
  });
  await expect(page.getByTestId("digit-recall-prompt")).toBeVisible();
}

export async function enterDigitSpanAnswer(page: Page, digits: number[]) {
  for (let i = 0; i < digits.length; i += 1) {
    await page.getByTestId(`digit-key-${digits[i]}`).click();
    await expect(page.getByTestId("digit-response")).toHaveText(digits.slice(0, i + 1).join(" "), {
      timeout: 5_000,
    });
  }
  await page.getByTestId("digit-submit").click();
}

export async function completeDigitSpanTraining(page: Page) {
  await page.goto("/student/training/digit-span");
  await expect(page.getByTestId("digit-stimulus")).toBeVisible({ timeout: 30_000 });

  const subtitle = await page.locator("header p").innerText();
  const match = subtitle.match(/\/ (\d+) ?/);
  const total = match ? Number(match[1]) : 14;

  for (let attempt = 0; attempt < total; attempt += 1) {
    if (attempt === 0) {
      await expect(page.getByTestId("digit-stimulus")).toBeVisible();
    } else {
      await expect(page.getByTestId("digit-stimulus")).toBeVisible({ timeout: 20_000 });
    }

    await waitForDigitSpanResponsePhase(page);
    await expect(page.getByTestId("digit-stimulus")).toHaveCount(0);

    const meta = await readDigitSpanAttemptMeta(page);
    const digits = responseDigitsForAttempt(meta.mode, meta.length, meta.attemptIndex);
    await enterDigitSpanAnswer(page, digits);

    if (attempt < total - 1) {
      await expect(page.getByTestId("digit-response")).toHaveText("�", { timeout: 20_000 });
    }
  }

  await expect(page.getByTestId("session-status")).toHaveText("completed", { timeout: 60_000 });
  await expect(page.getByTestId("metric-forward_max_span")).toBeVisible();
}

export async function simulateVisibility(page: Page, hidden: boolean) {
  await page.evaluate((isHidden) => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => isHidden });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
}

export async function installMockPerformanceClock(page: Page) {
  await page.addInitScript(() => {
    let mockNow = 0;
    const originalNow = performance.now.bind(performance);
    performance.now = () => mockNow;
    (window as unknown as { __setMockNow: (value: number) => void }).__setMockNow = (
      value: number,
    ) => {
      mockNow = value;
    };
    (window as unknown as { __advanceMockNow: (delta: number) => void }).__advanceMockNow = (
      delta: number,
    ) => {
      mockNow += delta;
    };
    (window as unknown as { __resetMockNow: () => void }).__resetMockNow = () => {
      mockNow = originalNow();
    };
  });
}

export async function advanceMockClock(page: Page, deltaMs: number) {
  await page.evaluate((delta) => {
    (window as unknown as { __advanceMockNow: (value: number) => void }).__advanceMockNow(delta);
  }, deltaMs);
}

export async function fetchSessionDetail(page: Page, sessionId: string) {
  const response = await page.request.get(`/api/training/sessions/${sessionId}`);
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as {
    status: string;
    eventCount: number;
  };
}

export async function createVerifiedSecondParent(
  request: APIRequestContext,
  fixture: E2eFixture,
  suffix: string,
) {
  const parent2Email = `e2e-parent2-${suffix}@test.local`;
  const parent2Password = "Parent1aXy";

  await loginApi(request, fixture.adminEmail, fixture.adminPassword);
  const inviteResponse = await request.post("/api/admin/invitations", {
    data: {
      targetRole: "parent",
      idempotencyKey: `m5-invite-${suffix}`,
    },
  });
  expect(inviteResponse.ok(), await inviteResponse.text()).toBeTruthy();
  const invite = (await inviteResponse.json()) as { code: string };

  const registerResponse = await request.post("/api/auth/register", {
    data: {
      invitationCode: invite.code,
      displayName: "E2E Parent Two",
      email: parent2Email,
      password: parent2Password,
      idempotencyKey: `m5-reg-${suffix}`,
    },
  });
  expect(registerResponse.ok(), await registerResponse.text()).toBeTruthy();

  const issueResponse = await request.post("/api/auth/verify-contact/issue", {
    data: { idempotencyKey: `m5-issue-${suffix}` },
  });
  expect(issueResponse.ok(), await issueResponse.text()).toBeTruthy();
  const issued = (await issueResponse.json()) as { devOtp: string };

  const confirmResponse = await request.post("/api/auth/verify-contact/confirm", {
    data: {
      otp: issued.devOtp,
      idempotencyKey: `m5-confirm-${suffix}`,
    },
  });
  expect(confirmResponse.ok(), await confirmResponse.text()).toBeTruthy();

  await loginApi(request, fixture.studentUsername, fixture.studentPassword);
  const codeResponse = await request.post("/api/association-codes", {
    data: { idempotencyKey: `m5-code-${suffix}` },
  });
  expect(codeResponse.ok(), await codeResponse.text()).toBeTruthy();
  const codePayload = (await codeResponse.json()) as { code: string };

  await loginApi(request, parent2Email, parent2Password);
  const linkResponse = await request.post("/api/relationship-requests", {
    data: {
      associationCode: codePayload.code,
      idempotencyKey: `m5-link-${suffix}`,
    },
  });
  expect(linkResponse.ok(), await linkResponse.text()).toBeTruthy();

  await loginApi(request, fixture.studentUsername, fixture.studentPassword);
  const pendingResponse = await request.get("/api/relationship-requests");
  expect(pendingResponse.ok(), await pendingResponse.text()).toBeTruthy();
  const pending = (await pendingResponse.json()) as {
    requests: Array<{ requestId: string; parentId: string }>;
  };
  const parent2Request = pending.requests.at(-1);
  expect(parent2Request?.requestId).toBeTruthy();

  const acceptResponse = await request.post(
    `/api/relationship-requests/${parent2Request!.requestId}/accept`,
    {
      data: { idempotencyKey: `m5-accept-${suffix}` },
    },
  );
  expect(acceptResponse.ok(), await acceptResponse.text()).toBeTruthy();

  return { email: parent2Email, password: parent2Password };
}

export function expectedDigitSpanAttempts(ageBand: string) {
  return buildDigitSpanAttemptPlan(ageBand);
}
