import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

type Fixture = {
  adminEmail: string;
  adminPassword: string;
  parentEmail: string;
  parentPassword: string;
  studentUsername: string;
  studentPassword: string;
  studentId: string;
};

const EVIDENCE_DIR = path.join(
  process.cwd(),
  ".trellis/tasks/08-25-m1-verification-remediation/research/screenshots",
);

function loadFixture(): Fixture {
  return JSON.parse(
    readFileSync(path.join(process.cwd(), "tests/e2e/.fixture.json"), "utf8"),
  ) as Fixture;
}

async function fillField(page: import("@playwright/test").Page, testId: string, value: string) {
  const input = page.getByTestId(testId);
  await expect(input).toBeVisible();
  await input.click();
  const inputType = await input.getAttribute("type");
  if (inputType === "date") {
    await input.fill(value);
  } else {
    await input.fill("");
    await input.pressSequentially(value, { delay: 15 });
  }
  await expect(input).toHaveValue(value);
}

async function loginViaUi(
  page: import("@playwright/test").Page,
  identifier: string,
  password: string,
) {
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "登录" })).toBeEnabled();
  await fillField(page, "login-identifier", identifier);
  await fillField(page, "login-password", password);
  const loginResponse = page.waitForResponse(
    (resp) => resp.url().includes("/api/auth/login") && resp.request().method() === "POST",
  );
  await page.getByRole("textbox", { name: "密码" }).press("Enter");
  expect((await loginResponse).ok()).toBeTruthy();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20_000 });
}

async function logoutViaUi(page: import("@playwright/test").Page) {
  await page.context().clearCookies();
  await page.goto("/login", { waitUntil: "networkidle" });
  await expect(page.getByRole("button", { name: "登录" })).toBeVisible({ timeout: 15_000 });
}

async function ensureFixtureTraining(request: import("@playwright/test").APIRequestContext) {
  const fixture = loadFixture();
  const loginResponse = await request.post("/api/auth/login", {
    data: {
      identifier: fixture.studentUsername,
      password: fixture.studentPassword,
      idempotencyKey: `evidence-login-${Date.now()}`,
    },
  });
  expect(loginResponse.ok()).toBeTruthy();

  const startResponse = await request.post("/api/training/sessions", {
    data: {
      trainingKey: "reaction",
      idempotencyKey: `evidence-start-${Date.now()}`,
    },
  });
  expect(startResponse.ok()).toBeTruthy();
  const started = (await startResponse.json()) as { sessionId: string };

  let sequence = 0;
  for (let trialIndex = 0; trialIndex < 5; trialIndex += 1) {
    const stimulusResponse = await request.post(
      `/api/training/sessions/${started.sessionId}/events`,
      {
        data: {
          sequence,
          eventType: "trial.stimulus",
          payload: { trialIndex, stimulusId: `evidence-${trialIndex}` },
        },
      },
    );
    expect(stimulusResponse.ok()).toBeTruthy();
    sequence += 1;
    await new Promise((resolve) => setTimeout(resolve, 220));
    const responseEvent = await request.post(
      `/api/training/sessions/${started.sessionId}/events`,
      {
        data: {
          sequence,
          eventType: "trial.response",
          payload: { trialIndex, correct: true, inputMethod: "keyboard" },
        },
      },
    );
    expect(responseEvent.ok()).toBeTruthy();
    sequence += 1;
  }

  const submitResponse = await request.post(
    `/api/training/sessions/${started.sessionId}/submit`,
    {
      data: {
        idempotencyKey: `evidence-submit-${Date.now()}`,
      },
    },
  );
  expect(submitResponse.ok()).toBeTruthy();

  await request.post("/api/auth/session", {
    data: { idempotencyKey: `evidence-logout-${Date.now()}` },
  });
}

test.describe("M1 browser evidence capture", () => {
  test.beforeAll(async ({ request }) => {
    mkdirSync(path.join(EVIDENCE_DIR, "desktop"), { recursive: true });
    mkdirSync(path.join(EVIDENCE_DIR, "mobile-360"), { recursive: true });
    await ensureFixtureTraining(request);
  });

  test("desktop key pages", async ({ page }) => {
    test.setTimeout(120_000);
    const fixture = loadFixture();
    await page.setViewportSize({ width: 1280, height: 720 });

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "BrainDance" })).toBeVisible();
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, "desktop", "01-home-logged-out.png"),
      fullPage: true,
    });

    await loginViaUi(page, fixture.adminEmail, fixture.adminPassword);
    await page.goto("/admin/invitations");
    await expect(page.getByRole("button", { name: "生成邀请码" })).toBeVisible();
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, "desktop", "02-admin-invitations.png"),
      fullPage: true,
    });

    await logoutViaUi(page);
    await loginViaUi(page, fixture.studentUsername, fixture.studentPassword);
    await page.goto("/student/training/reaction");
    await expect(page.getByTestId("training-target")).toBeVisible({ timeout: 30_000 });
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, "desktop", "03-student-training-reaction.png"),
      fullPage: true,
    });

    await logoutViaUi(page);
    await loginViaUi(page, fixture.parentEmail, fixture.parentPassword);
    await page.goto(`/parent/students/${fixture.studentId}/training`);
    await expect(page.getByTestId("parent-metric-median_reaction_ms")).toBeVisible({
      timeout: 15_000,
    });
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, "desktop", "04-parent-training-summary.png"),
      fullPage: true,
    });

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
  });

  test("mobile 360 key pages", async ({ page }) => {
    test.setTimeout(120_000);
    const fixture = loadFixture();
    await page.setViewportSize({ width: 360, height: 800 });

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "BrainDance" })).toBeVisible();
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, "mobile-360", "01-home-logged-out.png"),
      fullPage: true,
    });

    await loginViaUi(page, fixture.studentUsername, fixture.studentPassword);
    await page.goto("/student/training/reaction");
    await expect(page.getByTestId("training-target")).toBeVisible({ timeout: 30_000 });
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, "mobile-360", "02-student-training-reaction.png"),
      fullPage: true,
    });

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);

    await logoutViaUi(page);
    await loginViaUi(page, fixture.parentEmail, fixture.parentPassword);
    await page.goto(`/parent/students/${fixture.studentId}/training`);
    await expect(page.getByTestId("parent-metric-median_reaction_ms")).toBeVisible({
      timeout: 15_000,
    });
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, "mobile-360", "03-parent-training-summary.png"),
      fullPage: true,
    });

    const scrollWidthParent = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidthParent = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidthParent).toBeLessThanOrEqual(clientWidthParent + 1);
  });
});
