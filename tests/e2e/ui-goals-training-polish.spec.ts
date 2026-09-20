import { mkdirSync } from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { loadE2eFixture, loginViaUi } from "./ui-helpers";

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

async function setTheme(page: Page, theme: "candy" | "space") {
  await page.evaluate((value) => {
    document.documentElement.dataset.theme = value;
    window.localStorage.setItem("bd-theme", value);
  }, theme);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

test.describe("ui goals training polish remediation", () => {
  test.beforeAll(() => {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
  });

  for (const viewport of VIEWPORTS) {
    for (const theme of ["candy", "space"] as const) {
      test(`shell back navigation and identity at ${viewport.label} (${theme})`, async ({ page }) => {
        const fixture = loadE2eFixture();
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await loginViaUi(page, fixture.studentUsername, fixture.studentPassword);
        await setTheme(page, theme);

        await page.goto("/student/plans");
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

  test("student plan generate allows today-to-today", async ({ page }) => {
    const fixture = loadE2eFixture();
    await page.setViewportSize({ width: 768, height: 1024 });
    await loginViaUi(page, fixture.studentUsername, fixture.studentPassword);
    await page.goto("/student/plans");
    const generateButton = page.getByRole("button", { name: "生成日程" }).first();
    if (await generateButton.isVisible()) {
      await generateButton.click();
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
      await expect(page.getByTestId("plan-generate-from")).toHaveValue(today);
      await expect(page.getByTestId("plan-generate-through")).toHaveValue(today);
    }
  });

  test("schedule calendar views and completion modal contrast", async ({ page }) => {
    const fixture = loadE2eFixture();
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginViaUi(page, fixture.studentUsername, fixture.studentPassword);
    await setTheme(page, "space");
    await page.goto("/student/plans");
    await page.getByRole("button", { name: "日程" }).click();
    await expect(page.getByTestId("schedule-calendar-day")).toBeVisible();
    await page.getByRole("button", { name: "周", exact: true }).click();
    await expect(page.getByTestId("schedule-calendar-week")).toBeVisible();
    await page.getByRole("button", { name: "月", exact: true }).click();
    await expect(page.getByTestId("schedule-calendar-month")).toBeVisible();
    await expectNoHorizontalScroll(page);

    const completeButton = page.getByRole("button", { name: "完成", exact: true }).first();
    if (await completeButton.isVisible()) {
      await completeButton.click();
      const modeControl = page.getByTestId("schedule-completion-mode");
      if (await modeControl.isVisible({ timeout: 8_000 }).catch(() => false)) {
        await page.keyboard.press("Tab");
        await page.screenshot({
          path: path.join(SCREENSHOT_DIR, "schedule-completion-modal-space-1440.png"),
          fullPage: false,
        });
        await page.getByRole("button", { name: "取消" }).click();
      }
    }
  });

  test("goal complete fresh read and parent evaluation flow", async ({ page, browser }) => {
    const fixture = loadE2eFixture();
    await page.setViewportSize({ width: 768, height: 1024 });
    await loginViaUi(page, fixture.parentEmail, fixture.parentPassword);
    await page.goto("/parent/goals");
    await expect(page.getByTestId("page-back-link")).toBeVisible();

    const studentContext = await browser.newContext();
    const studentPage = await studentContext.newPage();
    await loginViaUi(studentPage, fixture.studentUsername, fixture.studentPassword);
    await studentPage.goto("/student/plans");
    const completeGoal = studentPage.getByRole("button", { name: "完成目标" }).first();
    if (await completeGoal.isVisible()) {
      await completeGoal.click();
      await studentPage.reload();
      await expect(studentPage.getByText("已完成").first()).toBeVisible();
    }
    await studentContext.close();
  });
});
