import { expect, test } from "@playwright/test";

import { loadE2eFixture, loginViaUi } from "./ui-helpers";

test.describe("student growth workbench", () => {
  test("renders one workbench without tabs or standalone today overview", async ({ page }) => {
    const fixture = loadE2eFixture();
    await loginViaUi(page, fixture.studentUsername, fixture.studentPassword);

    await page.goto("/student/plans");
    await expect(page.getByTestId("student-growth-workbench")).toBeVisible();
    await expect(page.getByRole("heading", { name: "我的成长工作台" })).toBeVisible();
    await expect(page.getByTestId("workbench-summary")).toBeVisible();
    await expect(page.getByRole("heading", { name: "积分余额与今日任务" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "我的今日概览" })).toHaveCount(0);
    await expect(page.getByRole("tab")).toHaveCount(0);
    await expect(page.locator('[role="tablist"]')).toHaveCount(0);
    await expect(page.getByTestId("points-today-card")).toHaveCount(0);

    await expect(page.getByRole("heading", { name: "日程日历" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "计划", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "目标", exact: true })).toBeVisible();

    const viewport = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(viewport.scroll).toBeLessThanOrEqual(viewport.client + 1);
  });
});
