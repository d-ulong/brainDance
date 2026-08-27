import { expect, test } from "@playwright/test";

import { fillField, loadE2eFixture, loginViaUi, logoutViaUi } from "./ui-helpers";

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function completeTraining(page: import("@playwright/test").Page) {
  await page.goto("/student/training/reaction");
  const target = page.getByTestId("training-target");
  await expect(target).toBeVisible({ timeout: 30_000 });

  for (let trial = 0; trial < 5; trial += 1) {
    await expect(target).toContainText("Space / Enter", { timeout: 10_000 });
    await page.waitForTimeout(180);
    await target.click();
    if (trial < 4) {
      await page.waitForTimeout(150);
    }
  }

  await expect(page.getByTestId("session-status")).toHaveText("completed", { timeout: 30_000 });
  await expect(page.getByTestId("metric-median_reaction_ms")).toBeVisible();
}

test.describe("M1 browser flow", () => {
  test.setTimeout(180_000);

  test("full M1 path via UI controls", async ({ page }) => {
    const fixture = loadE2eFixture();
    const suffix = uniqueSuffix();
    const parentEmail = `e2e-parent-${suffix}@test.local`;
    const parentPassword = "ParentPass123!Parent";
    const studentUsername = `e2e_student_${suffix.slice(-8)}`;
    const initialPassword = "InitialPass123!Go";
    const studentPassword = "StudentPass123!Student";

    await loginViaUi(page, fixture.adminEmail, fixture.adminPassword);
    await page.goto("/admin/invitations");
    const createInviteButton = page.getByRole("button", { name: "生成邀请码" });
    await expect(createInviteButton).toBeVisible({ timeout: 15_000 });
    await createInviteButton.click();
    const invitationCode = await page.getByTestId("invitation-code").innerText();
    expect(invitationCode.length).toBeGreaterThan(8);
    await logoutViaUi(page);

    await page.goto("/register");
    await fillField(page, "register-invitation-code", invitationCode);
    await fillField(page, "register-display-name", "E2E Parent");
    await fillField(page, "register-email", parentEmail);
    await fillField(page, "register-password", parentPassword);
    await page.getByRole("button", { name: "注册并继续验证" }).click();

    await page.waitForURL("**/verify-contact");
    const devOtp = await page.getByTestId("dev-otp").innerText({ timeout: 30_000 });
    const otpMatch = devOtp.match(/\d{4,8}/);
    expect(otpMatch).toBeTruthy();
    await fillField(page, "verify-otp", otpMatch![0]);
    await page.getByRole("button", { name: "确认验证" }).click();
    await page.waitForURL("/");

    await page.goto("/parent/students/new");
    await fillField(page, "student-username", studentUsername);
    await fillField(page, "student-birth-date", "2015-06-01");
    await fillField(page, "student-initial-password", initialPassword);
    await page.getByRole("button", { name: "创建学生" }).click();
    await expect(page.getByTestId("created-student-username")).toHaveText(studentUsername);
    await logoutViaUi(page);

    await loginViaUi(page, studentUsername, initialPassword);
    await page.waitForURL("**/student/change-password");
    await fillField(page, "current-password", initialPassword);
    await fillField(page, "new-password", studentPassword);
    await page.getByRole("button", { name: "确认修改" }).click();
    await page.waitForURL("/");

    await page.goto("/student/link");
    await page.getByRole("button", { name: "生成关联码" }).click();
    const associationCode = await page.getByTestId("association-code").innerText();
    await logoutViaUi(page);

    await loginViaUi(page, parentEmail, parentPassword);
    await page.goto("/parent/link");
    await fillField(page, "association-code-input", associationCode);
    await page.getByRole("button", { name: "发送关联申请" }).click();
    await expect(page.getByText("关联申请已发送")).toBeVisible();
    await logoutViaUi(page);

    await loginViaUi(page, studentUsername, studentPassword);
    await page.goto("/student/link");
    await expect(page.getByRole("button", { name: "接受关联" })).toBeVisible({ timeout: 15_000 });
    const acceptResponse = page.waitForResponse(
      (resp) => resp.url().includes("/accept") && resp.request().method() === "POST",
    );
    await page.getByRole("button", { name: "接受关联" }).click();
    const acceptResult = await acceptResponse;
    expect(acceptResult.ok(), await acceptResult.text()).toBeTruthy();
    await expect(page.getByText("暂无待处理的关联申请")).toBeVisible({ timeout: 15_000 });

    await completeTraining(page);
    const sessionUrl = page.url();
    const sessionId = sessionUrl.split("/").pop();
    expect(sessionId).toBeTruthy();

    await page.reload();
    await expect(page.getByTestId("session-status")).toHaveText("completed");
    const medianAfterReload = await page.getByTestId("metric-median_reaction_ms").innerText();
    expect(medianAfterReload.length).toBeGreaterThan(0);

    await logoutViaUi(page);
    await loginViaUi(page, studentUsername, studentPassword);
    await page.goto(`/student/training/${sessionId}`);
    await expect(page.getByTestId("session-status")).toHaveText("completed");
    await expect(page.getByTestId("metric-median_reaction_ms")).toBeVisible();

    await logoutViaUi(page);
    await loginViaUi(page, parentEmail, parentPassword);
    await page.goto("/parent/students");
    await page
      .locator("li")
      .filter({ hasText: studentUsername })
      .getByRole("link", { name: "训练汇总" })
      .click();
    await expect(page.getByTestId("parent-metric-median_reaction_ms")).toBeVisible({
      timeout: 15_000,
    });

    const studentIdFromList = page.url().match(/students\/([^/]+)\/training/)?.[1];
    expect(studentIdFromList).toBeTruthy();

    await page.getByRole("button", { name: "解除关联" }).click();
    await expect(page.getByTestId("parent-forbidden")).toBeVisible({ timeout: 15_000 });

    const studentIdFromUrl = page.url().match(/students\/([^/]+)\/training/)?.[1];
    expect(studentIdFromUrl).toBeTruthy();
    const profileResponse = await page.request.get(
      `/api/family/students/${studentIdFromUrl}/profile`,
    );
    expect(profileResponse.status()).toBe(403);

    const summaryResponse = await page.request.get(
      `/api/students/${studentIdFromUrl}/training-summary?trainingKey=reaction`,
    );
    expect(summaryResponse.status()).toBe(403);
  });

  test("has no horizontal scroll on 360px viewport", async ({ page }) => {
    const fixture = loadE2eFixture();
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "BrainDance" })).toBeVisible();

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);

    await loginViaUi(page, fixture.adminEmail, fixture.adminPassword);
    await page.goto("/admin/invitations");
    const scrollWidthAdmin = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidthAdmin = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidthAdmin).toBeLessThanOrEqual(clientWidthAdmin + 1);
  });
});
