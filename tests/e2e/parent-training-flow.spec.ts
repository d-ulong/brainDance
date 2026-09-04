import { expect, test } from "@playwright/test";

import { assertNoHorizontalScroll, completeReactionTraining } from "./m5-training-helpers";
import { loadE2eFixture, loginViaUi } from "./ui-helpers";

test.describe("Parent training center flow", () => {
  test.setTimeout(180_000);

  test("parent completes own reaction training under /parent/training", async ({ page }) => {
    const fixture = loadE2eFixture();
    await loginViaUi(page, fixture.parentEmail, fixture.parentPassword);

    await page.goto("/");
    await expect(page.getByTestId("parent-training-nav")).toBeVisible();
    await page.getByTestId("parent-training-nav").click();
    await expect(page).toHaveURL(/\/parent\/training\/?$/);
    await expect(page.getByTestId("parent-training-hub")).toBeVisible();
    await expect(page.getByTestId("parent-training-adult-notice")).toBeVisible();
    await expect(page.getByTestId("parent-training-entry-reaction")).toBeVisible();
    await expect(page.getByTestId("parent-training-entry-stroop")).toBeVisible();
    await expect(page.getByTestId("parent-training-entry-digit-span")).toBeVisible();

    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toContain(fixture.studentId);
    await expect(page.getByRole("link", { name: /积分|日程|兑换|家庭推送/ })).toHaveCount(0);
    await expect(page.locator("[data-testid^='points-']")).toHaveCount(0);

    await completeReactionTraining(page, "pointer", "/parent/training");

    await expect(page).toHaveURL(/\/parent\/training\/[0-9a-f-]{36}$/i);
    await expect(page.getByTestId("age-band")).toHaveAttribute("data-age-band", "adult");
    await expect(page.getByTestId("age-band")).toContainText("成人");
    await expect(page.getByTestId("parent-training-metrics")).toBeVisible();
    await expect(page.getByTestId("parent-training-trends-panel")).toBeVisible();
    await expect(page.getByTestId("parent-training-result-notice")).toBeVisible();

    const resultText = await page.locator("body").innerText();
    expect(resultText).not.toContain(fixture.studentId);
    await expect(page.getByRole("link", { name: /积分|日程|兑换|家庭推送/ })).toHaveCount(0);
    expect(resultText).not.toMatch(/5–8|9–12|13–18/);

    await assertNoHorizontalScroll(page);
  });
});
