import { expect, test } from "@playwright/test";

import { loadE2eFixture, loginViaUi } from "./ui-helpers";

test.describe("modal sticky close control", () => {
  test("keeps the close button visible while a long plan form scrolls", async ({ page }) => {
    const fixture = loadE2eFixture();
    await loginViaUi(page, fixture.parentEmail, fixture.parentPassword);

    await page.goto("/parent/plans");
    await page.getByTestId("plan-library-create").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const closeButton = dialog.getByRole("button", { name: "关闭" });
    await expect(closeButton).toBeVisible();

    for (let index = 0; index < 8; index += 1) {
      await dialog.getByRole("button", { name: "添加内容项" }).click();
    }
    await dialog.locator("form").evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    const scrollParent = dialog.locator("div.min-h-0.flex-1.overflow-y-auto");
    await scrollParent.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    await expect(closeButton).toBeInViewport();
    await closeButton.click();
    await expect(dialog).toHaveCount(0);
  });
});
