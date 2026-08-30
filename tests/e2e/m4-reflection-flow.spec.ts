import { expect, test, type Page } from "@playwright/test";

import { loadE2eFixture, loginViaUi } from "./ui-helpers";

async function assertNoHorizontalScroll(page: Page) {
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
}

async function switchAccount(page: Page, identifier: string, password: string) {
  await page.context().clearCookies();
  await loginViaUi(page, identifier, password);
}

test.describe("M4 reflection privacy flow", () => {
  test.setTimeout(180_000);

  test("AC-M4-4 student private reflection grant/revoke parent read path", async ({ page }) => {
    const fixture = loadE2eFixture();
    const privateBody = `E2E private reflection ${Date.now()}`;

    await loginViaUi(page, fixture.studentUsername, fixture.studentPassword);
    await page.goto("/student/reflection");
    await expect(page.getByTestId("reflection-body-input")).toBeVisible({ timeout: 15_000 });

    await page.getByTestId("reflection-visibility-private").check();
    await page.getByTestId("reflection-body-input").fill(privateBody);
    const saveResponse = page.waitForResponse(
      (resp) =>
        resp.request().method() === "PUT" &&
        resp.url().includes("/daily-reflections/") &&
        !resp.url().includes("/grants"),
    );
    await page.getByTestId("reflection-save-button").click();
    const saved = await saveResponse;
    expect(saved.ok(), await saved.text()).toBeTruthy();
    await expect(page.getByTestId("reflection-action-message")).toContainText("总结已保存", {
      timeout: 15_000,
    });

    const grantButton = fixture.parentId
      ? page.getByTestId(`grant-parent-${fixture.parentId}`)
      : page.getByRole("button", { name: "授权" }).first();
    await expect(grantButton).toBeEnabled({ timeout: 15_000 });

    const grantResponse = page.waitForResponse(
      (resp) => resp.request().method() === "POST" && resp.url().includes("/grants"),
    );
    await grantButton.click();
    const granted = await grantResponse;
    expect(granted.ok(), await granted.text()).toBeTruthy();
    await expect(page.getByTestId("reflection-action-message")).toContainText("已授权", {
      timeout: 15_000,
    });

    await assertNoHorizontalScroll(page);
    await switchAccount(page, fixture.parentEmail, fixture.parentPassword);
    await page.goto(`/parent/students/${fixture.studentId}/reflection`);
    await expect(page.getByTestId("reflection-body")).toContainText(privateBody, {
      timeout: 15_000,
    });
    await assertNoHorizontalScroll(page);

    await switchAccount(page, fixture.studentUsername, fixture.studentPassword);
    await page.goto("/student/reflection");
    const revokeButton = page.locator('[data-testid^="revoke-grant-"]').first();
    await expect(revokeButton).toBeEnabled({ timeout: 15_000 });
    const revokeResponse = page.waitForResponse(
      (resp) => resp.request().method() === "DELETE" && resp.url().includes("/grants/"),
    );
    await revokeButton.click();
    const revoked = await revokeResponse;
    expect(revoked.ok(), await revoked.text()).toBeTruthy();
    await expect(page.getByTestId("reflection-action-message")).toContainText("已撤销", {
      timeout: 15_000,
    });

    await switchAccount(page, fixture.parentEmail, fixture.parentPassword);
    await page.goto(`/parent/students/${fixture.studentId}/reflection`);
    await expect(page.getByTestId("reflection-forbidden")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(privateBody)).toHaveCount(0);
    await assertNoHorizontalScroll(page);
  });
});
