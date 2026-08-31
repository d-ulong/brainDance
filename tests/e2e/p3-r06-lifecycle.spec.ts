import { expect, test } from "@playwright/test";

import {
  advanceMockClock,
  installMockPerformanceClock,
  simulateVisibility,
  waitForReactionReady,
} from "./m5-training-helpers";
import { loadE2eFixture, loginViaUi } from "./ui-helpers";

test.describe("P3-R06 lifecycle gate evidence", () => {
  test.setTimeout(180_000);

  test("P3-R06-C1: deferred stimulus stays closed when append completes while hidden", async ({
    page,
  }) => {
    const fixture = loadE2eFixture();
    await loginViaUi(page, fixture.studentUsername, fixture.studentPassword);

    let releaseStimulus: (() => void) | null = null;
    const stimulusGate = new Promise<void>((resolve) => {
      releaseStimulus = resolve;
    });

    await page.route("**/api/training/sessions/*/events", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      const body = route.request().postDataJSON() as { eventType?: string } | null;
      if (body?.eventType === "trial.stimulus") {
        await stimulusGate;
      }
      await route.continue();
    });

    await page.goto("/student/training/reaction");
    await expect(page.getByTestId("training-target")).toBeVisible({ timeout: 30_000 });

    await simulateVisibility(page, true);
    releaseStimulus!();

    await expect(page.getByTestId("training-paused")).toBeVisible();
    await expect(page.getByTestId("training-target")).toBeDisabled();
    await expect(page.getByTestId("training-target")).toContainText("准备下一次");
  });

  test("P3-R06-C1: syncs pause when session binds while document hidden", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => true,
      });
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "hidden",
      });
    });

    const fixture = loadE2eFixture();
    await loginViaUi(page, fixture.studentUsername, fixture.studentPassword);
    await page.goto("/student/training/reaction");

    await expect(page.getByTestId("training-paused")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("training-target")).toBeDisabled();
  });

  test("P3-R06-C1: recovery failure never reopens interaction after deferred stimulus", async ({
    page,
  }) => {
    const fixture = loadE2eFixture();
    await loginViaUi(page, fixture.studentUsername, fixture.studentPassword);
    await page.goto("/student/training/reaction");
    await waitForReactionReady(page);

    await page.route("**/api/training/sessions/*/events", async (route) => {
      const body = route.request().postDataJSON() as { eventType?: string } | null;
      if (body?.eventType === "session.blur") {
        await route.abort("failed");
        return;
      }
      await route.continue();
    });

    await simulateVisibility(page, true);
    await simulateVisibility(page, false);

    await expect(page.getByText("失焦恢复失败，训练已终止")).toBeVisible({ timeout: 45_000 });
    await expect(page.getByTestId("training-target")).toHaveCount(0);
  });

  test("P3-R06-C1: abandoned blur never reopens interaction", async ({ page }) => {
    await installMockPerformanceClock(page);
    const fixture = loadE2eFixture();
    await loginViaUi(page, fixture.studentUsername, fixture.studentPassword);
    await page.goto("/student/training/reaction");
    await waitForReactionReady(page);

    await simulateVisibility(page, true);
    await advanceMockClock(page, 31_000);
    await simulateVisibility(page, false);

    await expect(page.getByText("训练因失焦时间过长已终止")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("training-target")).toHaveCount(0);
  });

  test("P3-R06-C2: digit span timer survives hidden/pause race and resumes once", async ({
    page,
  }) => {
    const fixture = loadE2eFixture();
    await loginViaUi(page, fixture.studentUsername, fixture.studentPassword);
    await page.goto("/student/training/digit-span");
    await expect(page.getByTestId("digit-stimulus")).toBeVisible({ timeout: 30_000 });

    await page.waitForTimeout(500);

    await simulateVisibility(page, true);
    await expect(page.getByTestId("training-paused")).toBeVisible();

    await page.waitForTimeout(2_000);

    await expect(page.getByTestId("digit-stimulus")).toBeVisible();
    await expect(page.getByTestId("digit-response")).not.toHaveAttribute("data-ready", "true");

    await simulateVisibility(page, false);
    await expect(page.getByTestId("training-paused")).toBeHidden({ timeout: 15_000 });

    await expect(page.getByTestId("digit-stimulus")).toBeHidden({ timeout: 10_000 });
    await expect(page.getByTestId("digit-response")).toHaveAttribute("data-ready", "true", {
      timeout: 10_000,
    });
  });
});
