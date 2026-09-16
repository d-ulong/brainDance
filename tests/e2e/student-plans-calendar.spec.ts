import { expect, test } from "@playwright/test";

import { loadE2eFixture, loginViaUi } from "./ui-helpers";

test.describe("student plans and calendar workspace", () => {
  test("keeps schedule out of primary tabs and lets a student create an own plan", async ({ page }) => {
    const fixture = loadE2eFixture();
    await loginViaUi(page, fixture.studentUsername, fixture.studentPassword);

    await page.goto("/");
    await expect(page.getByTestId("top-tab-student-schedule")).toHaveCount(0);
    await expect(page.getByRole("link", { name: /今日日程/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /我的计划/ })).toBeVisible();

    await page.goto("/student/schedule");
    await expect(page.getByTestId("schedule-calendar-day")).toBeVisible();
    await page.getByRole("button", { name: "周", exact: true }).click();
    await expect(page.getByTestId("schedule-calendar-week")).toBeVisible();
    await page.getByRole("button", { name: "月", exact: true }).click();
    await expect(page.getByTestId("schedule-calendar-month")).toBeVisible();
    const viewport = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    expect(viewport.scroll).toBeLessThanOrEqual(viewport.client + 1);

    await page.goto("/account");
    await expect(page.getByRole("link", { name: /计划日程/ })).toBeVisible();

    await page.goto("/student/plans");
    await page.getByTestId("student-plan-create").click();
    const title = `自主阅读 ${test.info().project.name}`;
    await page.getByLabel("计划名称", { exact: true }).fill(title);
    await page.getByLabel("内容名称", { exact: true }).fill("阅读二十分钟");
    const activation = page.waitForResponse((response) => response.url().includes("/activate") && response.ok());
    await page.getByTestId("student-plan-save").click();
    await activation;
    await expect(page.getByText(title, { exact: true })).toBeVisible();
    await expect(page.getByText(/已启用/).first()).toBeVisible();
  });
});
