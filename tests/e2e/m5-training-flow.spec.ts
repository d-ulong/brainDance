import { expect, test } from "@playwright/test";

import {
  assertNoHorizontalScroll,
  completeDigitSpanTraining,
  completeReactionTraining,
  completeStroopTraining,
} from "./m5-training-helpers";
import { loadE2eFixture, loginViaUi, logoutViaUi } from "./ui-helpers";

test.describe("M5 training UI flow", () => {
  test.setTimeout(300_000);

  test("training hub lists three trainings with disclaimer", async ({ page }) => {
    const fixture = loadE2eFixture();
    await loginViaUi(page, fixture.studentUsername, fixture.studentPassword);
    await page.goto("/student/training");

    await expect(page.getByTestId("training-disclaimer")).toBeVisible();
    await expect(page.getByTestId("training-entry-reaction")).toBeVisible();
    await expect(page.getByTestId("training-entry-stroop")).toBeVisible();
    await expect(page.getByTestId("training-entry-digit-span")).toBeVisible();
    await assertNoHorizontalScroll(page);
  });

  test("reaction training via keyboard and trends on result page", async ({ page }) => {
    const fixture = loadE2eFixture();
    await loginViaUi(page, fixture.studentUsername, fixture.studentPassword);

    await page.goto("/student/training/reaction");
    const target = page.getByTestId("training-target");
    await expect(target).toBeVisible({ timeout: 30_000 });

    for (let trial = 0; trial < 5; trial += 1) {
      await page.waitForTimeout(180);
      await target.focus();
      await page.keyboard.press("Space");
      if (trial < 4) await page.waitForTimeout(150);
    }

    await expect(page.getByTestId("session-status")).toHaveText("completed", { timeout: 30_000 });
    await expect(page.getByTestId("student-trends-panel")).toBeVisible();
    await expect(page.getByTestId("student-trends-window-7d")).toBeVisible();

    const sessionUrl = page.url();
    const sessionId = sessionUrl.split("/").pop();
    await page.reload();
    await expect(page.getByTestId("session-status")).toHaveText("completed");

    await logoutViaUi(page);
    await loginViaUi(page, fixture.studentUsername, fixture.studentPassword);
    await page.goto(`/student/training/${sessionId}`);
    await expect(page.getByTestId("metric-median_reaction_ms")).toBeVisible();
    await assertNoHorizontalScroll(page);
  });

  test("stroop training completes with color buttons", async ({ page }) => {
    const fixture = loadE2eFixture();
    await loginViaUi(page, fixture.studentUsername, fixture.studentPassword);
    await completeStroopTraining(page);
    await expect(page.getByTestId("student-trends-panel")).toBeVisible();
    await assertNoHorizontalScroll(page);
  });

  test("digit span training completes with touch targets", async ({ page }) => {
    test.setTimeout(180_000);
    const fixture = loadE2eFixture();
    await loginViaUi(page, fixture.studentUsername, fixture.studentPassword);
    await completeDigitSpanTraining(page);
    await expect(page.getByTestId("student-trends-window-30d")).toBeVisible();
    await page.getByTestId("student-trends-window-30d").click();
    await expect(page.getByTestId("student-trends-panel")).toBeVisible();
    await assertNoHorizontalScroll(page);
  });

  test("blur pause shows paused state without abandoning short blur", async ({ page }) => {
    const fixture = loadE2eFixture();
    await loginViaUi(page, fixture.studentUsername, fixture.studentPassword);
    await page.goto("/student/training/reaction");
    await expect(page.getByTestId("training-target")).toBeVisible({ timeout: 30_000 });

    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(page.getByTestId("training-paused")).toBeVisible();

    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(page.getByTestId("training-paused")).toBeHidden({ timeout: 10_000 });
  });

  test("weak network retries event submission", async ({ page }) => {
    const fixture = loadE2eFixture();
    await loginViaUi(page, fixture.studentUsername, fixture.studentPassword);
    await page.goto("/student/training/reaction");
    await expect(page.getByTestId("training-target")).toBeVisible({ timeout: 30_000 });

    let failEvents = 2;
    await page.route("**/api/training/sessions/*/events", async (route) => {
      if (failEvents > 0 && route.request().method() === "POST") {
        failEvents -= 1;
        await route.abort("failed");
        return;
      }
      await route.continue();
    });

    await page.waitForTimeout(180);
    await page.getByTestId("training-target").click();
    await expect(page.getByTestId("training-retry")).toBeVisible({ timeout: 15_000 });
  });

  test("parent views training summaries and trends without modifying scores", async ({ page }) => {
    const fixture = loadE2eFixture();

    await loginViaUi(page, fixture.studentUsername, fixture.studentPassword);
    await completeReactionTraining(page);
    await logoutViaUi(page);

    await loginViaUi(page, fixture.parentEmail, fixture.parentPassword);
    await page.goto(`/parent/students/${fixture.studentId}/training`);

    await expect(page.getByTestId("parent-metric-median_reaction_ms")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("parent-trends-panel")).toBeVisible();
    await page.getByTestId("parent-training-key-stroop").click();
    await expect(page.getByTestId("parent-training-key-stroop")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.getByTestId("parent-trends-window-all").click();
    await expect(page.getByText("家长仅可查看汇总与趋势，不能修改原始成绩。")).toBeVisible();
    await assertNoHorizontalScroll(page);
  });
});
