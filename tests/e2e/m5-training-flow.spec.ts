import { expect, test } from "@playwright/test";

import {
  advanceMockClock,
  assertNoHorizontalScroll,
  completeDigitSpanTraining,
  completeReactionTraining,
  completeStroopTraining,
  createVerifiedSecondParent,
  fetchSessionDetail,
  installMockPerformanceClock,
  respondToStroopTrial,
  simulateVisibility,
  waitForDigitSpanResponsePhase,
  waitForReactionReady,
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

    await completeReactionTraining(page, "keyboard");
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

  test("stroop keyboard selects focused option without auto-correct shortcut", async ({ page }) => {
    const fixture = loadE2eFixture();
    await loginViaUi(page, fixture.studentUsername, fixture.studentPassword);
    await page.goto("/student/training/stroop");
    await expect(page.getByTestId("stroop-stimulus")).toBeVisible({ timeout: 30_000 });

    await respondToStroopTrial(page, false);
    await expect(page.getByTestId("stroop-stimulus")).toBeVisible({ timeout: 15_000 });

    await respondToStroopTrial(page, true);
    await expect(page.getByTestId("stroop-stimulus")).toBeVisible({ timeout: 15_000 });
  });

  test("stroop training completes with color buttons", async ({ page }) => {
    const fixture = loadE2eFixture();
    await loginViaUi(page, fixture.studentUsername, fixture.studentPassword);
    await completeStroopTraining(page);
    await expect(page.getByTestId("student-trends-panel")).toBeVisible();
    await assertNoHorizontalScroll(page);
  });

  test("digit span hides stimulus before response and completes from known input", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const fixture = loadE2eFixture();
    await loginViaUi(page, fixture.studentUsername, fixture.studentPassword);
    await page.goto("/student/training/digit-span");
    await expect(page.getByTestId("digit-stimulus")).toBeVisible({ timeout: 30_000 });

    await waitForDigitSpanResponsePhase(page);
    await expect(page.getByTestId("digit-stimulus")).toHaveCount(0);
    await expect(page.locator("[data-expected]")).toHaveCount(0);

    await completeDigitSpanTraining(page);
    await expect(page.getByTestId("student-trends-window-30d")).toBeVisible();
    await page.getByTestId("student-trends-window-30d").click();
    await expect(page.getByTestId("student-trends-panel")).toBeVisible();
    await assertNoHorizontalScroll(page);
  });

  test("short blur resumes and completes reaction session once", async ({ page }) => {
    const fixture = loadE2eFixture();
    await loginViaUi(page, fixture.studentUsername, fixture.studentPassword);
    await page.goto("/student/training/reaction");
    const target = await waitForReactionReady(page);

    await simulateVisibility(page, true);
    await expect(page.getByTestId("training-paused")).toBeVisible();
    await expect(target).toBeDisabled();

    await simulateVisibility(page, false);
    await expect(page.getByTestId("training-paused")).toBeHidden({ timeout: 15_000 });
    await expect(target).toBeEnabled({ timeout: 15_000 });

    await completeReactionTraining(page, "pointer");
    await expect(page.getByTestId("session-status")).toHaveText("completed", { timeout: 30_000 });
  });

  test("blur over 30 seconds abandons session and blocks further submission", async ({ page }) => {
    await installMockPerformanceClock(page);
    const fixture = loadE2eFixture();
    await loginViaUi(page, fixture.studentUsername, fixture.studentPassword);
    await page.goto("/student/training/reaction");
    const target = await waitForReactionReady(page);

    await simulateVisibility(page, true);
    await advanceMockClock(page, 31_000);
    await simulateVisibility(page, false);

    await expect(page.getByText("训练因失焦时间过长已终止")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("training-target")).toHaveCount(0);
  });

  test("blur recovery failure terminates session", async ({ page }) => {
    const fixture = loadE2eFixture();
    await loginViaUi(page, fixture.studentUsername, fixture.studentPassword);
    await page.goto("/student/training/reaction");
    const target = await waitForReactionReady(page);

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

  test("weak network retries events and submit then completes with ordered events", async ({
    page,
  }) => {
    const fixture = loadE2eFixture();
    await loginViaUi(page, fixture.studentUsername, fixture.studentPassword);
    await page.goto("/student/training/reaction");
    const target = await waitForReactionReady(page);

    const postedSequences: number[] = [];
    let failedEventPosts = 0;
    let failEvents = 2;
    let failSubmit = 1;

    await page.route("**/api/training/sessions/*/events", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      const payload = route.request().postDataJSON() as { sequence?: number; eventType?: string };
      if (payload.eventType !== "session.blur" && failEvents > 0) {
        failEvents -= 1;
        failedEventPosts += 1;
        await route.abort("failed");
        return;
      }
      postedSequences.push(payload.sequence ?? -1);
      await route.continue();
    });

    await page.route("**/api/training/sessions/*/submit", async (route) => {
      if (failSubmit > 0) {
        failSubmit -= 1;
        await route.abort("failed");
        return;
      }
      await route.continue();
    });

    await expect(target).toBeEnabled({ timeout: 10_000 });
    const firstResponse = page.waitForResponse(
      (resp) =>
        resp.url().includes("/events") &&
        resp.request().method() === "POST" &&
        (resp.request().postDataJSON() as { eventType?: string } | null)?.eventType ===
          "trial.response",
    );
    await target.click();
    await firstResponse;
    await expect.poll(() => failedEventPosts, { timeout: 20_000 }).toBeGreaterThanOrEqual(1);

    for (let trial = 1; trial < 5; trial += 1) {
      const nextTarget = await waitForReactionReady(page);
      const trialResponse = page.waitForResponse(
        (resp) =>
          resp.url().includes("/events") &&
          resp.request().method() === "POST" &&
          (resp.request().postDataJSON() as { eventType?: string } | null)?.eventType ===
            "trial.response",
      );
      await nextTarget.click();
      await trialResponse;
    }

    await expect(page.getByTestId("session-status")).toHaveText("completed", { timeout: 60_000 });

    const sessionId = page.url().split("/").pop()!;
    const detail = await fetchSessionDetail(page, sessionId);
    expect(detail.status).toBe("completed");
    expect(detail.eventCount).toBe(10);
    expect(failedEventPosts).toBeGreaterThanOrEqual(1);
    expect(failSubmit).toBe(0);
    for (let index = 1; index < postedSequences.length; index += 1) {
      expect(postedSequences[index]).toBeGreaterThan(postedSequences[index - 1]!);
    }
    expect(new Set(postedSequences).size).toBe(postedSequences.length);
  });

  test("parent views training summaries and trends without modifying scores", async ({ page }) => {
    const fixture = loadE2eFixture();

    await loginViaUi(page, fixture.studentUsername, fixture.studentPassword);
    await completeReactionTraining(page);
    await logoutViaUi(page);

    await loginViaUi(page, fixture.parentEmail, fixture.parentPassword);
    await page.goto(`/parent/students/${fixture.studentId}/training`);

    await expect(page.getByTestId("parent-metric-median_reaction_ms")).toBeVisible({
      timeout: 30_000,
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

  test("parent unlink immediately revokes access while other parent retains read", async ({
    page,
    request,
  }) => {
    const fixture = loadE2eFixture();
    const suffix = `${Date.now()}`;
    const parent2 = await createVerifiedSecondParent(request, fixture, suffix);

    await loginViaUi(page, fixture.studentUsername, fixture.studentPassword);
    await completeReactionTraining(page);
    await logoutViaUi(page);

    await loginViaUi(page, fixture.parentEmail, fixture.parentPassword);
    await page.goto(`/parent/students/${fixture.studentId}/training`);
    await expect(page.getByTestId("parent-metric-median_reaction_ms")).toBeVisible({
      timeout: 30_000,
    });

    await logoutViaUi(page);
    await loginViaUi(page, parent2.email, parent2.password);
    await page.goto(`/parent/students/${fixture.studentId}/training`);
    await expect(page.getByTestId("parent-metric-median_reaction_ms")).toBeVisible({
      timeout: 30_000,
    });

    await page.getByRole("button", { name: "解除关联" }).click();
    await expect(page.getByTestId("parent-forbidden")).toBeVisible({ timeout: 15_000 });

    const profileResponse = await page.request.get(
      `/api/family/students/${fixture.studentId}/profile`,
    );
    expect(profileResponse.status()).toBe(403);

    const trendsResponse = await page.request.get(
      `/api/family/students/${fixture.studentId}/training-trends?trainingKey=reaction&window=7d`,
    );
    expect(trendsResponse.status()).toBe(403);

    await page.reload();
    await expect(page.getByTestId("parent-forbidden")).toBeVisible({ timeout: 15_000 });

    await logoutViaUi(page);
    await loginViaUi(page, parent2.email, parent2.password);
    await page.goto(`/parent/students/${fixture.studentId}/training`);
    await expect(page.getByTestId("parent-forbidden")).toBeVisible({ timeout: 15_000 });

    await logoutViaUi(page);
    await loginViaUi(page, fixture.parentEmail, fixture.parentPassword);
    await page.goto(`/parent/students/${fixture.studentId}/training`);
    await expect(page.getByTestId("parent-metric-median_reaction_ms")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("parent-trends-panel")).toBeVisible();
    await assertNoHorizontalScroll(page);
  });
});
