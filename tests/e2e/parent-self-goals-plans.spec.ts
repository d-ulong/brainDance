import { expect, test } from "@playwright/test";

import { loadE2eFixture, loginViaUi } from "./ui-helpers";

test.describe("parent personal goals/plans navigation", () => {
  test("account self links stay outside student management tabs", async ({ page }) => {
    const fixture = loadE2eFixture();
    await loginViaUi(page, fixture.parentEmail, fixture.parentPassword);

    await page.goto("/account");
    await page.getByRole("link", { name: "我的目标" }).click();
    await expect(page).toHaveURL(/\/parent\/goals\?scope=self/);
    await expect(page.getByRole("navigation", { name: "学生管理" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "我的个人目标" })).toBeVisible();
    await page.getByRole("link", { name: /返回/ }).click();
    await expect(page).toHaveURL(/\/account/);

    await page.getByRole("link", { name: "我的计划" }).click();
    await expect(page).toHaveURL(/\/parent\/plans\?scope=self/);
    await expect(page.getByRole("navigation", { name: "学生管理" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "我的个人计划" })).toBeVisible();
    await page.getByRole("link", { name: /返回/ }).click();
    await expect(page).toHaveURL(/\/account/);

    await page.goto("/parent/goals");
    await expect(page.getByRole("navigation", { name: "学生管理" })).toBeVisible();
    await page.goto("/parent/plans");
    await expect(page.getByRole("navigation", { name: "学生管理" })).toBeVisible();
  });
});
