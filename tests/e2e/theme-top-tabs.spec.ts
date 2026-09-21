import { expect, test } from "@playwright/test";

import { loadE2eFixture, loginViaUi, logoutViaUi } from "./ui-helpers";

async function expectNoHorizontalScroll(page: import("@playwright/test").Page) {
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
}

test("space theme is the default and candy theme persists in this browser", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "space");

  await page.getByTestId("theme-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "candy");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "candy");
});

test("role tabs stay visible and fit the mobile viewport", async ({ page }) => {
  const fixture = loadE2eFixture();

  await loginViaUi(page, fixture.parentEmail, fixture.parentPassword);
  await expect(page.getByTestId("top-tabs")).toBeVisible();
  await expect(page.getByTestId("top-tab-parent-training")).toBeVisible();
  await expect(page.getByTestId("top-tab-parent-home")).toHaveAttribute("aria-current", "page");
  await expectNoHorizontalScroll(page);

  await logoutViaUi(page);
  await loginViaUi(page, fixture.studentUsername, fixture.studentPassword);
  await expect(page.getByTestId("top-tabs")).toBeVisible();
  await expect(page.getByTestId("top-tab-student-training")).toBeVisible();
  await expect(page.getByTestId("top-tab-student-pushes")).toContainText("家庭推送");
  await expect(page.getByTestId("top-tab-student-home")).toHaveAttribute("aria-current", "page");
  await expectNoHorizontalScroll(page);
});

test("training tab navigation asks before cancelling an active session", async ({ page }) => {
  const fixture = loadE2eFixture();
  await loginViaUi(page, fixture.studentUsername, fixture.studentPassword);
  await page.goto("/student/training/reaction");
  await expect(page.getByTestId("training-target")).toBeVisible({ timeout: 20_000 });

  page.once("dialog", (dialog) => void dialog.dismiss());
  await page.getByTestId("top-tab-student-schedule").click();
  await expect(page).toHaveURL(/\/student\/training\/reaction/);

  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByTestId("top-tab-student-schedule").click();
  await expect(page).toHaveURL(/\/student\/schedule/, { timeout: 20_000 });
});
