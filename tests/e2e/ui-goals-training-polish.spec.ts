import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import {
  seedUiGoalsTrainingPolish,
  shanghaiToday,
  type UiGoalsTrainingSeed,
} from "./ui-goals-training-polish-helpers";
import { fillField, loadE2eFixture, loginViaUi } from "./ui-helpers";

const SCREENSHOT_DIR = path.join(
  process.cwd(),
  ".trellis/tasks/09-20-ui-goals-training-polish/references/e2e-remediation",
);

const VIEWPORTS = [
  { width: 360, height: 800, label: "360" },
  { width: 768, height: 1024, label: "768" },
  { width: 1440, height: 900, label: "1440" },
] as const;

async function expectNoHorizontalScroll(page: Page) {
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
}

async function applyThemeViaToggle(page: Page, theme: "candy" | "space") {
  await expect(page.getByTestId("theme-toggle")).toBeVisible();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const current = await page.locator("html").getAttribute("data-theme");
    if (current === theme) break;
    await page.getByTestId("theme-toggle").click();
  }
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await page.evaluate((value) => {
    window.localStorage.setItem("braindance-theme", value);
  }, theme);
  const stored = await page.evaluate(() => window.localStorage.getItem("braindance-theme"));
  expect(stored).toBe(theme);
}

async function loginWithTheme(
  page: Page,
  identifier: string,
  password: string,
  theme: "candy" | "space",
) {
  await page.goto("/login");
  await applyThemeViaToggle(page, theme);
  await expect(page.getByRole("button", { name: "登录" })).toBeEnabled();
  await fillField(page, "login-identifier", identifier);
  await fillField(page, "login-password", password);
  const loginResponse = page.waitForResponse(
    (resp) => resp.url().includes("/api/auth/login") && resp.request().method() === "POST",
  );
  await page.getByTestId("login-password").press("Enter");
  const response = await loginResponse;
  expect(response.ok(), await response.text()).toBeTruthy();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20_000 });
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

async function assertReadableModalColors(page: Page) {
  const colors = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) return null;
    const label = dialog.querySelector("label");
    const input = dialog.querySelector("input");
    if (!label || !input) return null;
    const labelColor = getComputedStyle(label).color;
    const inputColor = getComputedStyle(input).color;
    const surface = getComputedStyle(dialog).backgroundColor;
    return { labelColor, inputColor, surface };
  });
  expect(colors).not.toBeNull();
  expect(colors!.labelColor).not.toBe(colors!.surface);
  expect(colors!.inputColor).not.toBe(colors!.surface);
}

test.describe.configure({ mode: "serial" });
test.describe("ui goals training polish remediation", () => {
  test.setTimeout(300_000);

  let seed: UiGoalsTrainingSeed;

  test.beforeAll(async ({ request }) => {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    seed = await seedUiGoalsTrainingPolish(request, loadE2eFixture());
  });

  for (const viewport of VIEWPORTS) {
    for (const theme of ["candy", "space"] as const) {
      test(`shell back navigation and identity at ${viewport.label} (${theme})`, async ({ page }) => {
        const fixture = loadE2eFixture();
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await loginWithTheme(page, fixture.studentUsername, fixture.studentPassword, theme);

        await page.goto("/student/plans");
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await expect(page.getByTestId("page-back-link")).toBeVisible();
        await expect(page.getByTestId("shell-display-name")).toBeVisible();
        await expect(page.getByTestId("shell-shanghai-clock")).toBeVisible();
        await expectNoHorizontalScroll(page);

        await page.screenshot({
          path: path.join(SCREENSHOT_DIR, `shell-${theme}-${viewport.label}.png`),
          fullPage: true,
        });
      });
    }
  }

  test("candy and space shell evidence differ at each viewport", () => {
    for (const viewport of VIEWPORTS) {
      const candyPath = path.join(SCREENSHOT_DIR, `shell-candy-${viewport.label}.png`);
      const spacePath = path.join(SCREENSHOT_DIR, `shell-space-${viewport.label}.png`);
      const candyHash = createHash("sha256").update(readFileSync(candyPath)).digest("hex");
      const spaceHash = createHash("sha256").update(readFileSync(spacePath)).digest("hex");
      expect(candyHash).not.toBe(spaceHash);
    }
  });

  for (const viewport of VIEWPORTS) {
    test(`plan hierarchy and today-to-today at ${viewport.label}`, async ({ page }) => {
      const fixture = loadE2eFixture();
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await loginViaUi(page, fixture.studentUsername, fixture.studentPassword);
      await page.goto("/student/plans");
      await expect(page.getByTestId("workbench-summary")).toBeVisible();
      await expect(page.getByTestId("student-plan-create")).toBeVisible();
      await expect(page.getByLabel("计划开始日期")).toHaveCount(0);

      await page.goto("/student/plans/new");
      await expect(page.getByTestId("page-back-link")).toBeVisible();
      await expect(page.getByLabel("计划开始日期")).toHaveCount(0);
      await expectNoHorizontalScroll(page);

      await page.goto("/student/plans");
      const generateButton = page.getByRole("button", { name: "生成日程" }).first();
      await expect(generateButton).toBeVisible({ timeout: 20_000 });
      await generateButton.click();
      const today = shanghaiToday();
      await expect(page.getByTestId("plan-generate-from")).toHaveValue(today);
      await expect(page.getByTestId("plan-generate-through")).toHaveValue(today);
    });
  }

  for (const theme of ["candy", "space"] as const) {
    test(`schedule views, completion modal and evidence (${theme})`, async ({ page }) => {
      const fixture = loadE2eFixture();
      await page.setViewportSize({ width: 1440, height: 900 });
      await loginWithTheme(page, fixture.studentUsername, fixture.studentPassword, theme);
      await page.goto("/student/plans");
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await page.getByRole("button", { name: "日程", exact: true }).click();
      await expect(page.getByTestId("student-schedule-workspace")).toBeVisible();
      await expect(page.getByTestId("schedule-calendar-day")).toBeVisible();
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `schedule-day-${theme}-1440.png`),
        fullPage: true,
      });

      await page.getByRole("button", { name: "今天" }).click();
      const completeButton = page
        .getByRole("button", { name: "完成", exact: true })
        .and(page.locator(":visible"))
        .first();
      await expect(completeButton).toBeVisible({ timeout: 20_000 });
      await completeButton.scrollIntoViewIfNeeded();
      await completeButton.click();
      const modeControl = page.getByTestId("schedule-completion-mode");
      await expect(modeControl).toBeVisible();
      await assertReadableModalColors(page);
      await page.keyboard.press("Tab");
      const focusInDialog = await page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"]');
        return dialog?.contains(document.activeElement) ?? false;
      });
      expect(focusInDialog).toBe(true);
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `schedule-completion-modal-${theme}-1440.png`),
        fullPage: false,
      });
      await page.getByRole("button", { name: "取消" }).click();
      await expect(modeControl).toHaveCount(0);
      await expect(completeButton).toBeVisible();

      await page.getByRole("button", { name: "周", exact: true }).click();
      await expect(page.getByTestId("schedule-calendar-week")).toBeVisible();
      await expect(page.getByTestId("schedule-mobile-month")).toBeHidden();
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `schedule-week-${theme}-1440.png`),
        fullPage: true,
      });

      await page.getByRole("button", { name: "月", exact: true }).click();
      await expect(page.getByTestId("schedule-calendar-month")).toBeVisible();
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `schedule-month-${theme}-1440.png`),
        fullPage: true,
      });
      await expectNoHorizontalScroll(page);
    });
  }

  for (const theme of ["candy", "space"] as const) {
    test(`goal status cards evidence (${theme})`, async ({ page }) => {
      const fixture = loadE2eFixture();
      await page.setViewportSize({ width: 768, height: 1024 });
      await loginWithTheme(page, fixture.studentUsername, fixture.studentPassword, theme);
      await page.goto("/student/plans");
      await page.getByRole("button", { name: "目标", exact: true }).click();
      await expect(page.getByText(/Polish 目标/)).toBeVisible();
      await expect(page.locator(".bd-goal-status-chip").first()).toBeVisible();
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `goal-cards-${theme}-768.png`),
        fullPage: true,
      });
    });
  }

  test("goal complete fresh read and responsible parent evaluation", async ({ page }) => {
    const fixture = loadE2eFixture();
    await page.setViewportSize({ width: 768, height: 1024 });
    await loginViaUi(page, fixture.studentUsername, fixture.studentPassword);
    await page.goto("/student/plans");
    await page.getByRole("button", { name: "目标", exact: true }).click();
    const goalCard = page.locator("article").filter({ hasText: /Polish 目标/ });
    await expect(goalCard.getByRole("button", { name: "完成目标" })).toBeVisible();
    await goalCard.getByRole("button", { name: "完成目标" }).click();
    await expect(page.getByText("已完成 · 待评定").first()).toBeVisible();

    await page.reload();
    await page.getByRole("button", { name: "目标", exact: true }).click();
    await expect(page.getByText("已完成 · 待评定").first()).toBeVisible();

    await page.context().clearCookies();
    await loginViaUi(page, fixture.parentEmail, fixture.parentPassword);
    await page.goto("/parent/goals");
    await expect(page.getByTestId("page-back-link")).toBeVisible();
    const parentGoal = page.locator("article").filter({ hasText: /Polish 目标/ });
    await expect(parentGoal.getByRole("button", { name: "评定目标" })).toBeVisible();
    await parentGoal.getByRole("button", { name: "评定目标" }).click();
    await page.getByRole("button", { name: "确认评定" }).click();
    await expect(page.getByText("已评定 · 达成").first()).toBeVisible();

    await page.reload();
    await expect(page.getByText("已评定 · 达成").first()).toBeVisible();
  });

  const trainingCases = [
    { key: "reaction", sessionId: () => seed.reactionSessionId, metric: "metric-median_reaction_ms" },
    { key: "stroop", sessionId: () => seed.stroopSessionId, metric: "metric-interference_delta" },
    { key: "digit-span", sessionId: () => seed.digitSpanSessionId, metric: "metric-forward_max_span" },
  ] as const;

  for (const trainingCase of trainingCases) {
    test(`student ${trainingCase.key} answer review UI`, async ({ page }) => {
      const fixture = loadE2eFixture();
      await page.setViewportSize({ width: 360, height: 800 });
      await loginViaUi(page, fixture.studentUsername, fixture.studentPassword);
      await page.goto(`/student/training/${trainingCase.sessionId()}`);
      await expect(page.getByTestId("session-status")).toHaveText("completed");
      await expect(page.getByTestId("training-trial-review")).toBeVisible();
      await expect(page.getByTestId(trainingCase.metric)).toBeVisible();
      await expectNoHorizontalScroll(page);
      await page.screenshot({
        path: path.join(
          SCREENSHOT_DIR,
          `training-student-${trainingCase.key}-360.png`,
        ),
        fullPage: true,
      });
    });

    test(`authorized parent ${trainingCase.key} answer review path`, async ({ page }) => {
      const fixture = loadE2eFixture();
      await page.setViewportSize({ width: 768, height: 1024 });
      await loginViaUi(page, fixture.parentEmail, fixture.parentPassword);
      await page.goto(
        `/parent/students/${fixture.studentId}/training/${trainingCase.sessionId()}`,
      );
      await expect(page.getByTestId("parent-student-training-result-notice")).toBeVisible();
      await expect(page.getByTestId("session-status")).toHaveText("completed");
      await expect(page.getByTestId("training-trial-review")).toBeVisible();
      await page.screenshot({
        path: path.join(
          SCREENSHOT_DIR,
          `training-parent-${trainingCase.key}-768.png`,
        ),
        fullPage: true,
      });
    });
  }

  test("parent discovers child session from training summary link", async ({ page }) => {
    const fixture = loadE2eFixture();
    await loginViaUi(page, fixture.parentEmail, fixture.parentPassword);
    await page.goto(`/parent/students/${fixture.studentId}/training`);
    await page.getByTestId("parent-training-key-reaction").click();
    await expect(page.getByTestId("parent-student-training-session-link")).toBeVisible();
    await page.getByTestId("parent-student-training-session-link").click();
    await expect(page).toHaveURL(
      new RegExp(`/parent/students/${fixture.studentId}/training/[0-9a-f-]{36}$`, "i"),
    );
    await expect(page.getByTestId("training-trial-review")).toBeVisible();
  });

  for (const theme of ["candy", "space"] as const) {
    test(`training result theme evidence (${theme})`, async ({ page }) => {
      const fixture = loadE2eFixture();
      await page.setViewportSize({ width: 1440, height: 900 });
      await loginWithTheme(page, fixture.studentUsername, fixture.studentPassword, theme);
      await page.goto(`/student/training/${seed.reactionSessionId}`);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(page.getByTestId("training-trial-review")).toBeVisible();
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `training-result-${theme}-1440.png`),
        fullPage: true,
      });
    });
  }

  test("candy and space schedule completion modal evidence differ", () => {
    const candyHash = createHash("sha256")
      .update(readFileSync(path.join(SCREENSHOT_DIR, "schedule-completion-modal-candy-1440.png")))
      .digest("hex");
    const spaceHash = createHash("sha256")
      .update(readFileSync(path.join(SCREENSHOT_DIR, "schedule-completion-modal-space-1440.png")))
      .digest("hex");
    expect(candyHash).not.toBe(spaceHash);
  });
});
