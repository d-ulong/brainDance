import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, unlinkSync } from "node:fs";
import path from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  seedUiGoalsTrainingPolish,
  shanghaiToday,
  type TrainingReviewExpectations,
  type UiGoalsTrainingSeed,
} from "./ui-goals-training-polish-helpers";
import { fillField, loadE2eFixture, loginViaUi } from "./ui-helpers";

const STUDENT_DISPLAY_NAME = "E2E Student";

const SCREENSHOT_DIR = path.join(
  process.cwd(),
  ".trellis/tasks/09-20-ui-goals-training-polish/references/e2e-remediation",
);

const VIEWPORTS = [
  { width: 360, height: 800, label: "360" },
  { width: 768, height: 1024, label: "768" },
  { width: 1440, height: 900, label: "1440" },
] as const;

const CANDY_SPACE_HASH_PAIRS: Array<[string, string]> = [
  ["shell-candy-360.png", "shell-space-360.png"],
  ["shell-candy-768.png", "shell-space-768.png"],
  ["shell-candy-1440.png", "shell-space-1440.png"],
  ["schedule-day-candy-360.png", "schedule-day-space-360.png"],
  ["schedule-day-candy-768.png", "schedule-day-space-768.png"],
  ["schedule-day-candy-1440.png", "schedule-day-space-1440.png"],
  ["schedule-week-candy-360.png", "schedule-week-space-360.png"],
  ["schedule-week-candy-768.png", "schedule-week-space-768.png"],
  ["schedule-week-candy-1440.png", "schedule-week-space-1440.png"],
  ["schedule-month-candy-360.png", "schedule-month-space-360.png"],
  ["schedule-month-candy-768.png", "schedule-month-space-768.png"],
  ["schedule-month-candy-1440.png", "schedule-month-space-1440.png"],
  ["schedule-completion-modal-candy-360.png", "schedule-completion-modal-space-360.png"],
  ["schedule-completion-modal-candy-768.png", "schedule-completion-modal-space-768.png"],
  ["schedule-completion-modal-candy-1440.png", "schedule-completion-modal-space-1440.png"],
  ["goal-active-candy-768.png", "goal-active-space-768.png"],
  ["goal-completed-candy-768.png", "goal-completed-space-768.png"],
  ["goal-succeeded-candy-768.png", "goal-succeeded-space-768.png"],
  ["training-result-candy-1440.png", "training-result-space-1440.png"],
];

const OWNED_EVIDENCE_FILES = [
  ...new Set(CANDY_SPACE_HASH_PAIRS.flatMap(([candy, space]) => [candy, space])),
  "training-student-reaction-360.png",
  "training-student-stroop-360.png",
  "training-student-digit-span-360.png",
  "training-parent-reaction-768.png",
  "training-parent-stroop-768.png",
  "training-parent-digit-span-768.png",
  "goal-cards-candy-768.png",
  "goal-cards-space-768.png",
];

function sha256File(fileName: string): string {
  return createHash("sha256")
    .update(readFileSync(path.join(SCREENSHOT_DIR, fileName)))
    .digest("hex");
}

function assertCandySpacePairDiffers(candyFile: string, spaceFile: string) {
  const candyHash = sha256File(candyFile);
  const spaceHash = sha256File(spaceFile);
  expect(candyHash, `${candyFile} vs ${spaceFile}`).not.toBe(spaceHash);
}

async function expectNoHorizontalScroll(page: Page) {
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
}

async function assertTheme(page: Page, theme: "candy" | "space") {
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

async function applyThemeViaToggle(page: Page, theme: "candy" | "space") {
  await expect(page.getByTestId("theme-toggle")).toBeVisible();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const current = await page.locator("html").getAttribute("data-theme");
    if (current === theme) break;
    await page.getByTestId("theme-toggle").click();
  }
  await assertTheme(page, theme);
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
  await assertTheme(page, theme);
}

async function screenshotWithTheme(
  page: Page,
  theme: "candy" | "space",
  fileName: string,
  options?: Parameters<Page["screenshot"]>[0],
) {
  await assertTheme(page, theme);
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, fileName),
    ...options,
  });
}

async function applyThemeOnDocument(page: Page, theme: "candy" | "space") {
  await page.evaluate((value) => {
    window.localStorage.setItem("braindance-theme", value);
    document.documentElement.setAttribute("data-theme", value);
  }, theme);
  await assertTheme(page, theme);
}

function shanghaiClockExpectation(now = new Date()) {
  const month = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", month: "numeric" }).format(now),
  );
  const day = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", day: "numeric" }).format(now),
  );
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Shanghai",
      hour: "numeric",
      hour12: false,
    }).format(now),
  );
  const minute = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Shanghai",
      minute: "numeric",
    }).format(now),
  );
  return { month, day, hour, minute };
}

async function assertShellIdentity(page: Page) {
  const displayName = page.getByTestId("shell-display-name");
  await expect(displayName).toHaveText(STUDENT_DISPLAY_NAME);
  await expect(displayName).not.toHaveText("我");

  const clockText = await page.getByTestId("shell-shanghai-clock").innerText();
  expect(clockText.trim().length).toBeGreaterThan(0);
  const clockMatch = clockText.match(/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/);
  expect(clockMatch).not.toBeNull();
  const displayed = {
    month: Number(clockMatch![1]),
    day: Number(clockMatch![2]),
    hour: Number(clockMatch![3]),
    minute: Number(clockMatch![4]),
  };
  const now = Date.now();
  const acceptedShanghaiMinutes = [-1, 0, 1].map((offsetMinutes) =>
    shanghaiClockExpectation(new Date(now + offsetMinutes * 60_000)),
  );
  expect(acceptedShanghaiMinutes).toContainEqual(displayed);
}

async function assertGoalState(card: Locator, className: RegExp, exactLabel: string) {
  await expect(card).toHaveClass(className);
  await expect(card.getByText(exactLabel, { exact: true })).toBeVisible();
}

async function assertNoInternalHorizontalScroll(locator: Locator) {
  const dimensions = await locator.evaluate((element) => ({
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
}

async function assertVerticalScrollContainer(locator: Locator) {
  await expect(locator).toBeVisible();
  const styles = await locator.evaluate((element) => getComputedStyle(element).overflowY);
  expect(["auto", "scroll"]).toContain(styles);
  await assertNoInternalHorizontalScroll(locator);
}

async function assertHorizontalScrollContainer(locator: Locator) {
  await expect(locator).toBeVisible();
  const styles = await locator.evaluate((element) => getComputedStyle(element).overflowX);
  expect(["auto", "scroll"]).toContain(styles);
}

async function assertNonScrollingSurface(locator: Locator) {
  await expect(locator).toBeVisible();
  const styles = await locator.evaluate((element) => {
    const computed = getComputedStyle(element);
    return { overflowX: computed.overflowX, overflowY: computed.overflowY };
  });
  expect(styles.overflowX).not.toBe("scroll");
  expect(styles.overflowY).not.toBe("scroll");
  await assertNoInternalHorizontalScroll(locator);
}

async function assertCalendarViewDocumentAndScroll(
  page: Page,
  viewportLabel: (typeof VIEWPORTS)[number]["label"],
  view: "day" | "week" | "month",
) {
  await assertCalendarLayoutForViewport(page, viewportLabel, view);
  await expectNoHorizontalScroll(page);

  if (viewportLabel === "360") {
    if (view === "day") {
      await assertNonScrollingSurface(page.getByTestId("schedule-mobile-day-list"));
    } else if (view === "week") {
      await assertNonScrollingSurface(page.getByTestId("schedule-mobile-week"));
    } else {
      await assertNonScrollingSurface(page.getByTestId("schedule-mobile-month"));
    }
    await expect(page.locator(".bd-calendar-day-scroll")).toBeHidden();
    await expect(page.locator(".bd-calendar-scroll")).toBeHidden();
    await expect(page.locator(".bd-calendar-month")).toBeHidden();
    return;
  }

  await expect(page.getByTestId("schedule-mobile-day-list")).toBeHidden();
  await expect(page.getByTestId("schedule-mobile-week")).toBeHidden();
  await expect(page.getByTestId("schedule-mobile-month")).toBeHidden();

  if (view === "day") {
    await assertVerticalScrollContainer(page.locator(".bd-calendar-day-scroll"));
    return;
  }
  if (view === "week") {
    await assertHorizontalScrollContainer(page.locator(".bd-calendar-scroll"));
    return;
  }
  await expect(page.locator(".bd-calendar-month")).toBeVisible();
  const calendarOverflowX = await page.locator("section.bd-calendar").evaluate((element) => {
    return getComputedStyle(element).overflowX;
  });
  expect(calendarOverflowX).toBe("hidden");
}

async function assertModalContrastRatios(page: Page) {
  const ratios = await page.evaluate(() => {
    function parseChannel(value: number) {
      const normalized = value / 255;
      return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    }

    function parseCssColor(input: string): [number, number, number] | null {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.fillStyle = "#000000";
      ctx.fillStyle = input;
      const normalized = ctx.fillStyle;
      const hex = normalized.match(/^#([0-9a-f]{6})$/i);
      if (hex) {
        const value = hex[1]!;
        return [
          Number.parseInt(value.slice(0, 2), 16),
          Number.parseInt(value.slice(2, 4), 16),
          Number.parseInt(value.slice(4, 6), 16),
        ];
      }
      const match = normalized.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (!match) return null;
      return [Number(match[1]), Number(match[2]), Number(match[3])];
    }

    function luminance(rgb: [number, number, number]) {
      const [r, g, b] = rgb.map(parseChannel);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }

    function contrast(fg: string, bg: string) {
      const fgRgb = parseCssColor(fg);
      const bgRgb = parseCssColor(bg);
      if (!fgRgb || !bgRgb) return 0;
      const l1 = luminance(fgRgb);
      const l2 = luminance(bgRgb);
      const lighter = Math.max(l1, l2);
      const darker = Math.min(l1, l2);
      return (lighter + 0.05) / (darker + 0.05);
    }

    function surfaceBehind(element: Element | null): string {
      let node: Element | null = element;
      while (node) {
        const bg = getComputedStyle(node).backgroundColor;
        if (bg && !bg.includes("rgba(0, 0, 0, 0)") && bg !== "transparent") return bg;
        node = node.parentElement;
      }
      return "rgb(255, 255, 255)";
    }

    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) return null;
    const label = dialog.querySelector("label");
    const input = dialog.querySelector('input[type="datetime-local"], input[type="number"]');
    const help = dialog.querySelector(".bd-modal-body p");
    if (!label || !input || !help) return null;
    const labelStyle = getComputedStyle(label);
    const inputStyle = getComputedStyle(input);
    const helpStyle = getComputedStyle(help);
    const panel = dialog.querySelector(".bd-modal-panel") ?? dialog;
    const dialogSurface = surfaceBehind(panel);
    const inputSurface = surfaceBehind(input);
    return {
      label: contrast(labelStyle.color, dialogSurface),
      input: contrast(inputStyle.color, inputSurface),
      help: contrast(helpStyle.color, dialogSurface),
    };
  });
  expect(ratios).not.toBeNull();
  expect(ratios!.label).toBeGreaterThanOrEqual(4.5);
  expect(ratios!.input).toBeGreaterThanOrEqual(4.5);
  expect(ratios!.help).toBeGreaterThanOrEqual(4.5);
}

async function assertModalFocusBehavior(page: Page, completeButton: Locator) {
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const focusables = dialog.locator(
    'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])',
  );
  const count = await focusables.count();
  expect(count).toBeGreaterThan(1);

  const activeInDialog = await page.evaluate(() => {
    const dialogEl = document.querySelector('[role="dialog"]');
    return dialogEl?.contains(document.activeElement) ?? false;
  });
  expect(activeInDialog).toBe(true);

  await focusables.nth(count - 1).focus();
  await page.keyboard.press("Tab");
  await expect(focusables.first()).toBeFocused();

  await focusables.first().focus();
  await page.keyboard.press("Shift+Tab");
  await expect(focusables.nth(count - 1)).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(completeButton).toBeFocused();

  await completeButton.click();
  await expect(page.getByTestId("schedule-completion-mode")).toBeVisible();
  await page.getByRole("button", { name: "取消" }).click();
  await expect(page.getByTestId("schedule-completion-mode")).toHaveCount(0);
  await expect(completeButton).toBeFocused();
}

async function assertCalendarLayoutForViewport(
  page: Page,
  viewportLabel: (typeof VIEWPORTS)[number]["label"],
  view: "day" | "week" | "month",
) {
  const mobileDay = page.getByTestId("schedule-mobile-day-list");
  const mobileWeek = page.getByTestId("schedule-mobile-week");
  const mobileMonth = page.getByTestId("schedule-mobile-month");
  const desktopDay = page.locator(".bd-calendar-day-scroll");
  const desktopWeek = page.locator(".bd-calendar-scroll");
  const desktopMonth = page.locator(".bd-calendar-month");

  if (viewportLabel === "360") {
    if (view === "day") {
      await expect(mobileDay).toBeVisible();
      await expect(desktopDay).toBeHidden();
    } else if (view === "week") {
      await expect(mobileWeek).toBeVisible();
      await expect(desktopWeek).toBeHidden();
    } else {
      await expect(mobileMonth).toBeVisible();
      await expect(desktopMonth).toBeHidden();
    }
  } else {
    await expect(mobileDay).toBeHidden();
    await expect(mobileWeek).toBeHidden();
    await expect(mobileMonth).toBeHidden();
    if (view === "day") {
      await expect(desktopDay).toHaveCount(1);
    } else if (view === "week") {
      await expect(desktopWeek).toBeVisible();
    } else {
      await expect(desktopMonth).toBeVisible();
    }
  }
}

async function openScheduleCompletionModal(page: Page) {
  await page.getByRole("button", { name: "今天" }).click();
  const completeButton = page
    .getByRole("button", { name: "完成", exact: true })
    .and(page.locator(":visible"))
    .first();
  await expect(completeButton).toBeVisible({ timeout: 20_000 });
  await completeButton.scrollIntoViewIfNeeded();
  await completeButton.click();
  await expect(page.getByTestId("schedule-completion-mode")).toBeVisible();
  return completeButton;
}

function reviewValueLocator(row: Locator, label: string) {
  return row.locator(
    `xpath=.//dt[normalize-space(.)=${JSON.stringify(label)}]/following-sibling::dd[1]`,
  );
}

async function assertTrainingReviewRow(
  page: Page,
  kind: keyof TrainingReviewExpectations,
  expected: TrainingReviewExpectations[typeof kind],
) {
  const row = page.locator(".bd-training-review-row").first();
  await expect(row).toBeVisible();
  if (kind === "reaction") {
    const values = expected as TrainingReviewExpectations["reaction"];
    await expect(reviewValueLocator(row, "期望动作")).toHaveText(values.expectedAction);
    await expect(reviewValueLocator(row, "我的作答")).toHaveText(values.actualAction);
    await expect(reviewValueLocator(row, "是否正确")).toHaveText(values.correctLabel);
    return;
  }
  if (kind === "stroop") {
    const values = expected as TrainingReviewExpectations["stroop"];
    await expect(reviewValueLocator(row, "正确颜色")).toHaveText(values.expectedColor);
    await expect(reviewValueLocator(row, "我的选择")).toHaveText(values.selectedColor);
    await expect(reviewValueLocator(row, "是否正确")).toHaveText(values.correctLabel);
    return;
  }
  const values = expected as TrainingReviewExpectations["digitSpan"];
  await expect(reviewValueLocator(row, "呈现序列")).toHaveText(values.presentedSequence);
  await expect(reviewValueLocator(row, "正确答案")).toHaveText(values.expectedSequence);
  await expect(reviewValueLocator(row, "我的输入")).toHaveText(values.submittedSequence);
  await expect(reviewValueLocator(row, "是否正确")).toHaveText(values.correctLabel);
}

test.describe.configure({ mode: "serial", timeout: 300_000 });
test.describe("ui goals training polish remediation", () => {
  let seed: UiGoalsTrainingSeed;

  test.beforeAll(async ({ request }, testInfo) => {
    testInfo.setTimeout(300_000);
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    for (const fileName of OWNED_EVIDENCE_FILES) {
      try {
        unlinkSync(path.join(SCREENSHOT_DIR, fileName));
      } catch {
        // missing stale file is fine
      }
    }
    seed = await seedUiGoalsTrainingPolish(request, loadE2eFixture());
  });

  for (const viewport of VIEWPORTS) {
    for (const theme of ["candy", "space"] as const) {
      test(`shell back navigation and identity at ${viewport.label} (${theme})`, async ({
        page,
      }) => {
        const fixture = loadE2eFixture();
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await loginWithTheme(page, fixture.studentUsername, fixture.studentPassword, theme);
        await page.goto("/student/plans");
        await assertTheme(page, theme);
        await expect(page.getByTestId("page-back-link")).toBeVisible();
        await assertShellIdentity(page);
        await expectNoHorizontalScroll(page);
        await screenshotWithTheme(page, theme, `shell-${theme}-${viewport.label}.png`, {
          fullPage: true,
        });
      });
    }
  }

  test("candy and space shell evidence differ at each viewport", () => {
    for (const viewport of VIEWPORTS) {
      assertCandySpacePairDiffers(
        `shell-candy-${viewport.label}.png`,
        `shell-space-${viewport.label}.png`,
      );
    }
  });

  for (const viewport of VIEWPORTS) {
    test(`plan hierarchy and today-to-today at ${viewport.label}`, async ({ page }) => {
      const fixture = loadE2eFixture();
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await loginViaUi(page, fixture.studentUsername, fixture.studentPassword);
      await page.goto("/student/plans");
      await assertTheme(page, "space");
      await expect(page.getByTestId("workbench-summary")).toBeVisible();
      await expect(page.getByTestId("student-plan-create")).toBeVisible();
      await expect(page.getByLabel("计划开始日期")).toHaveCount(0);

      await page.goto("/student/plans/new");
      await assertTheme(page, "space");
      await expect(page.getByTestId("page-back-link")).toBeVisible();
      await expect(page.getByLabel("计划开始日期")).toHaveCount(0);
      await expectNoHorizontalScroll(page);

      await page.goto("/student/plans");
      await assertTheme(page, "space");
      const generateButton = page.getByRole("button", { name: "生成日程" }).first();
      await expect(generateButton).toBeVisible({ timeout: 20_000 });
      await generateButton.click();
      const today = shanghaiToday();
      await expect(page.getByTestId("plan-generate-from")).toHaveValue(today);
      await expect(page.getByTestId("plan-generate-through")).toHaveValue(today);
    });
  }

  for (const theme of ["candy", "space"] as const) {
    for (const viewport of VIEWPORTS) {
      test(`schedule day/week/month and completion modal (${theme} @ ${viewport.label})`, async ({
        page,
      }) => {
        const fixture = loadE2eFixture();
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await loginWithTheme(page, fixture.studentUsername, fixture.studentPassword, theme);
        await page.goto("/student/plans");
        await assertTheme(page, theme);
        await page.getByRole("button", { name: "日程", exact: true }).click();
        await expect(page.getByTestId("student-schedule-workspace")).toBeVisible();

        await assertCalendarViewDocumentAndScroll(page, viewport.label, "day");
        await screenshotWithTheme(page, theme, `schedule-day-${theme}-${viewport.label}.png`, {
          fullPage: true,
        });

        const completeButton = await openScheduleCompletionModal(page);
        await assertModalContrastRatios(page);
        await screenshotWithTheme(
          page,
          theme,
          `schedule-completion-modal-${theme}-${viewport.label}.png`,
          { fullPage: false },
        );
        await assertModalFocusBehavior(page, completeButton);

        await page.getByRole("button", { name: "周", exact: true }).click();
        await assertCalendarViewDocumentAndScroll(page, viewport.label, "week");
        await screenshotWithTheme(page, theme, `schedule-week-${theme}-${viewport.label}.png`, {
          fullPage: true,
        });

        await page.getByRole("button", { name: "月", exact: true }).click();
        await assertCalendarViewDocumentAndScroll(page, viewport.label, "month");
        await screenshotWithTheme(page, theme, `schedule-month-${theme}-${viewport.label}.png`, {
          fullPage: true,
        });
      });
    }
  }

  test("goal status progression, fresh reads and dual-theme evidence", async ({ page }) => {
    const fixture = loadE2eFixture();
    await page.setViewportSize({ width: 768, height: 1024 });
    await loginWithTheme(page, fixture.studentUsername, fixture.studentPassword, "candy");
    await page.goto("/student/plans");
    await assertTheme(page, "candy");
    await page.getByRole("button", { name: "目标", exact: true }).click();

    const goalCard = () => page.locator("article").filter({ hasText: seed.goalContent });

    async function openGoalsWorkspace() {
      await expect(page.getByTestId("workbench-summary")).toBeVisible({ timeout: 20_000 });
      await page.getByRole("button", { name: "目标", exact: true }).click();
      await expect(goalCard()).toBeVisible({ timeout: 20_000 });
    }

    await openGoalsWorkspace();
    await assertGoalState(goalCard(), /bd-goal-card-active/, "进行中");
    await screenshotWithTheme(page, "candy", "goal-active-candy-768.png", { fullPage: true });

    await applyThemeOnDocument(page, "space");
    await assertGoalState(goalCard(), /bd-goal-card-active/, "进行中");
    await screenshotWithTheme(page, "space", "goal-active-space-768.png", { fullPage: true });

    const completeResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/goals/") &&
        response.url().includes("/complete") &&
        response.request().method() === "POST" &&
        response.ok(),
    );
    await goalCard().getByRole("button", { name: "完成目标" }).click();
    await completeResponse;
    await assertGoalState(goalCard(), /bd-goal-card-completed/, "已完成 · 待评定");
    await screenshotWithTheme(page, "space", "goal-completed-space-768.png", { fullPage: true });
    await applyThemeOnDocument(page, "candy");
    await assertGoalState(goalCard(), /bd-goal-card-completed/, "已完成 · 待评定");
    await screenshotWithTheme(page, "candy", "goal-completed-candy-768.png", { fullPage: true });

    await page.reload();
    await assertTheme(page, "candy");
    await openGoalsWorkspace();
    await assertGoalState(goalCard(), /bd-goal-card-completed/, "已完成 · 待评定");

    await page.context().clearCookies();
    await page.goto("/login");
    await page.evaluate(() => window.localStorage.removeItem("braindance-theme"));
    await loginWithTheme(page, fixture.parentEmail, fixture.parentPassword, "space");
    await page.goto("/parent/goals");
    await assertTheme(page, "space");
    const parentGoal = page.locator("article").filter({ hasText: seed.goalContent });
    await expect(parentGoal).toBeVisible({ timeout: 20_000 });
    await assertGoalState(parentGoal, /bd-goal-card-completed/, "已完成 · 待评定");
    await expect(parentGoal.getByRole("button", { name: "评定目标" })).toBeVisible();
    await parentGoal.getByRole("button", { name: "评定目标" }).click();
    const evaluateResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/goals/") &&
        response.url().includes("/evaluate") &&
        response.request().method() === "POST" &&
        response.ok(),
    );
    await page.getByRole("button", { name: "确认评定" }).click();
    await evaluateResponse;
    await assertGoalState(parentGoal, /bd-goal-card-succeeded/, "已评定 · 达成");

    await page.reload();
    await assertTheme(page, "space");
    const refreshedParentGoal = page.locator("article").filter({ hasText: seed.goalContent });
    await expect(refreshedParentGoal).toBeVisible({ timeout: 20_000 });
    await assertGoalState(refreshedParentGoal, /bd-goal-card-succeeded/, "已评定 · 达成");

    await page.context().clearCookies();
    await loginWithTheme(page, fixture.studentUsername, fixture.studentPassword, "candy");
    await page.goto("/student/plans?view=goals");
    await assertTheme(page, "candy");
    await openGoalsWorkspace();
    await assertGoalState(goalCard(), /bd-goal-card-succeeded/, "已评定 · 达成");
    await screenshotWithTheme(page, "candy", "goal-succeeded-candy-768.png", { fullPage: true });
    await applyThemeOnDocument(page, "space");
    await assertGoalState(goalCard(), /bd-goal-card-succeeded/, "已评定 · 达成");
    await screenshotWithTheme(page, "space", "goal-succeeded-space-768.png", { fullPage: true });
  });

  test("candy and space goal evidence differs for each lifecycle state", () => {
    assertCandySpacePairDiffers("goal-active-candy-768.png", "goal-active-space-768.png");
    assertCandySpacePairDiffers("goal-completed-candy-768.png", "goal-completed-space-768.png");
    assertCandySpacePairDiffers("goal-succeeded-candy-768.png", "goal-succeeded-space-768.png");
  });

  const trainingCases = [
    {
      key: "reaction" as const,
      reviewKey: "reaction" as const,
      sessionId: () => seed.reactionSessionId,
      metric: "metric-median_reaction_ms",
    },
    {
      key: "stroop" as const,
      reviewKey: "stroop" as const,
      sessionId: () => seed.stroopSessionId,
      metric: "metric-interference_delta",
    },
    {
      key: "digit-span" as const,
      reviewKey: "digitSpan" as const,
      sessionId: () => seed.digitSpanSessionId,
      metric: "metric-forward_max_span",
    },
  ];

  for (const trainingCase of trainingCases) {
    test(`student ${trainingCase.key} answer review UI`, async ({ page }) => {
      const fixture = loadE2eFixture();
      await page.setViewportSize({ width: 360, height: 800 });
      await loginViaUi(page, fixture.studentUsername, fixture.studentPassword);
      await page.goto(`/student/training/${trainingCase.sessionId()}`);
      await assertTheme(page, "space");
      await expect(page.getByTestId("session-status")).toHaveText("completed", {
        timeout: 20_000,
      });
      await assertTrainingReviewRow(
        page,
        trainingCase.reviewKey,
        seed.trainingReview[trainingCase.reviewKey],
      );
      await expect(page.getByTestId(trainingCase.metric)).toBeVisible();
      await expectNoHorizontalScroll(page);
      await screenshotWithTheme(page, "space", `training-student-${trainingCase.key}-360.png`, {
        fullPage: true,
      });
    });

    test(`authorized parent ${trainingCase.key} answer review path`, async ({ page }) => {
      const fixture = loadE2eFixture();
      await page.setViewportSize({ width: 768, height: 1024 });
      await loginViaUi(page, fixture.parentEmail, fixture.parentPassword);
      await page.goto(`/parent/students/${fixture.studentId}/training/${trainingCase.sessionId()}`);
      await assertTheme(page, "space");
      await expect(page.getByTestId("parent-student-training-result-notice")).toBeVisible({
        timeout: 20_000,
      });
      await expect(page.getByTestId("session-status")).toHaveText("completed", {
        timeout: 20_000,
      });
      await assertTrainingReviewRow(
        page,
        trainingCase.reviewKey,
        seed.trainingReview[trainingCase.reviewKey],
      );
      await screenshotWithTheme(page, "space", `training-parent-${trainingCase.key}-768.png`, {
        fullPage: true,
      });
    });
  }

  test("parent discovers child session from training summary link", async ({ page }) => {
    const fixture = loadE2eFixture();
    await loginViaUi(page, fixture.parentEmail, fixture.parentPassword);
    await page.goto(`/parent/students/${fixture.studentId}/training`);
    await assertTheme(page, "space");
    await page.getByTestId("parent-training-key-reaction").click();
    await expect(page.getByTestId("parent-student-training-session-link")).toBeVisible();
    await page.getByTestId("parent-student-training-session-link").click();
    await expect(page).toHaveURL(
      new RegExp(`/parent/students/${fixture.studentId}/training/[0-9a-f-]{36}$`, "i"),
    );
    await assertTrainingReviewRow(page, "reaction", seed.trainingReview.reaction);
  });

  for (const theme of ["candy", "space"] as const) {
    test(`training result theme evidence (${theme})`, async ({ page }) => {
      const fixture = loadE2eFixture();
      await page.setViewportSize({ width: 1440, height: 900 });
      await loginWithTheme(page, fixture.studentUsername, fixture.studentPassword, theme);
      await page.goto(`/student/training/${seed.reactionSessionId}`);
      await assertTheme(page, theme);
      await expect(page.getByTestId("session-status")).toHaveText("completed", {
        timeout: 20_000,
      });
      await assertTrainingReviewRow(page, "reaction", seed.trainingReview.reaction);
      await screenshotWithTheme(page, theme, `training-result-${theme}-1440.png`, {
        fullPage: true,
      });
    });
  }

  test("all candy and space evidence pairs differ", () => {
    for (const [candy, space] of CANDY_SPACE_HASH_PAIRS) {
      assertCandySpacePairDiffers(candy, space);
    }
  });
});
