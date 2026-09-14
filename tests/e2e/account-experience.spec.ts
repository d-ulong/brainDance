import { expect, test } from "@playwright/test";
import { loadE2eFixture, loginViaUi, logoutViaUi } from "./ui-helpers";

test("content home, profile, two themes and compact headers", async ({ page }, testInfo) => {
  const fixture = loadE2eFixture();
  await loginViaUi(page, fixture.studentUsername, fixture.studentPassword);
  await expect(page.getByRole("heading", { name: "我的今日概览" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "我的训练近况" })).toBeVisible();
  await expect(page.getByTestId("points-balance")).toHaveText("100");
  await expect(page.getByText("还没有完成记录，来试试吧").first()).toBeVisible();
  await expect(page.locator(".bd-brand svg")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("student-space.png"), fullPage: true });
  await page.getByTestId("theme-toggle").click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "candy");
  await expect(page.getByTestId("points-balance")).toHaveText("100");
  await expect(page.getByText("还没有完成记录，来试试吧").first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("student-candy.png"), fullPage: true });
  await page.getByTestId("top-tab-student-profile").click();
  await expect(page.getByTestId("account-name")).toHaveText("E2E Student");
  await expect(page.getByTestId("account-identifier")).toContainText(fixture.studentUsername);
  await page.getByTestId("top-tab-student-training").click();
  await expect(page.getByTestId("training-entry-reaction")).toBeVisible();
  const details = page.locator(".bd-page-help");
  await expect(details).not.toHaveAttribute("open");
  await details.locator("summary").click();
  await expect(details).toHaveAttribute("open", "");
});

test("teen registers through UI with required name and matching passwords", async ({ page }) => {
  const fixture = loadE2eFixture();
  await loginViaUi(page, fixture.adminEmail, fixture.adminPassword);
  const response = await page.request.post("/api/admin/invitations", {
    data: { targetRole: "student", idempotencyKey: crypto.randomUUID() },
  });
  expect(response.ok()).toBe(true);
  const { code } = await response.json();
  await logoutViaUi(page);
  await page.goto("/register");
  await page.getByLabel("我是").selectOption("student");
  await page.getByTestId("register-invitation-code").fill(code);
  await page.getByTestId("register-display-name").fill("自主小星");
  const username = "teen_" + crypto.randomUUID().slice(0, 8);
  await page.getByTestId("register-username").fill(username);
  await page.getByTestId("register-birth-date").fill("2011-05-01");
  await page.getByTestId("register-password").fill("Abc123");
  await page.getByTestId("register-password-confirm").fill("Abc124");
  await page.getByTestId("register-submit").click();
  await expect(page.getByTestId("register-error")).toHaveText("两次输入的密码不一致");
  await page.getByTestId("register-password-confirm").fill("Abc123");
  await page.getByTestId("register-password-toggle").click();
  await expect(page.getByTestId("register-password")).toHaveAttribute("type", "text");
  await page.getByTestId("register-submit").click();
  await expect(page).toHaveURL(/\/$/);
  await page.getByTestId("top-tab-student-profile").click();
  await expect(page.getByTestId("account-name")).toHaveText("自主小星");
  await expect(page.getByTestId("account-identifier")).toContainText(username);
});

test("parent-created child immediately appears and refreshed parent session remains valid", async ({
  page,
}, testInfo) => {
  const fixture = loadE2eFixture();
  await loginViaUi(page, fixture.parentEmail, fixture.parentPassword);
  await expect(page.getByRole("heading", { name: "家庭今日动态" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("parent-home.png"), fullPage: true });
  await page.goto("/parent/students/new");
  const username = "child_" + crypto.randomUUID().slice(0, 8);
  await page.getByTestId("student-username").fill(username);
  await page.getByTestId("student-display-name").fill("自动关联小芽");
  await page.getByTestId("student-birth-date").fill("2017-01-01");
  await page.getByTestId("student-initial-password").fill("Abc123");
  await page.getByTestId("student-initial-password-confirm").fill("Abc123");
  await page.getByRole("checkbox").check();
  await page.getByTestId("create-student-submit").click();
  await expect(page.getByTestId("created-student-username")).toHaveText(username);
  await page.getByRole("link", { name: "查看我的家庭" }).click();
  await expect(page.getByText("@" + username, { exact: true })).toBeVisible();
  expect((await page.request.get("/api/auth/session")).ok()).toBe(true);
});
