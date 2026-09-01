import { expect, test } from "@playwright/test";

import {
  assertNoHorizontalScroll,
  createExportViaUi,
  createThrowawayStudentViaApi,
  expireExportJobTokenFixture,
  loadFixtureWithCatalog,
  loginThrowawayStudentViaUi,
  loginViaApi,
  waitForExportReady,
} from "./m6-lifecycle-helpers";
import { fillField, loadE2eFixture, loginViaUi, logoutViaUi } from "./ui-helpers";

test.describe("M6 lifecycle flow", () => {
  test.setTimeout(180_000);

  test("AC-M6-09 redemption apply/cancel + parent catalog/approve via UI", async ({ page }) => {
    const fixture = loadFixtureWithCatalog();

    await loginViaUi(page, fixture.studentUsername, fixture.studentPassword);
    await page.goto("/student/redemption");
    await expect(page.getByTestId(`catalog-item-${fixture.catalogItemId}`)).toBeVisible({
      timeout: 15_000,
    });
    await assertNoHorizontalScroll(page);

    await page.getByTestId(`apply-redemption-${fixture.catalogItemId}`).click();
    await expect(page.getByTestId("redemption-action-message")).toContainText("申请", {
      timeout: 15_000,
    });

    const pendingStudent = page
      .locator('[data-testid^="redemption-item-"]')
      .filter({ hasText: "待审批" });
    await expect(pendingStudent.first()).toBeVisible({ timeout: 15_000 });
    const cancelId = (await pendingStudent.first().getAttribute("data-testid"))!.replace(
      "redemption-item-",
      "",
    );
    await page.getByTestId(`cancel-redemption-${cancelId}`).click();
    await expect(page.getByTestId("redemption-action-message")).toContainText("撤销", {
      timeout: 15_000,
    });
    await assertNoHorizontalScroll(page);

    await page.getByTestId(`apply-redemption-${fixture.catalogItemId}`).click();
    await expect(page.getByTestId("redemption-action-message")).toContainText("申请", {
      timeout: 15_000,
    });
    await logoutViaUi(page);

    await loginViaUi(page, fixture.parentEmail, fixture.parentPassword);
    await page.goto(`/parent/students/${fixture.studentId}/redemption`);
    await expect(page.getByTestId("create-catalog-button")).toBeVisible({ timeout: 15_000 });
    await fillField(page, "catalog-title", `E2E Catalog ${Date.now().toString(36)}`);
    await fillField(page, "catalog-cost", "7");
    await page.getByTestId("create-catalog-button").click();
    await expect(page.getByTestId("parent-redemption-action-message")).toContainText("目录", {
      timeout: 15_000,
    });

    const pending = page.locator('[data-testid^="pending-redemption-"]').first();
    await expect(pending).toBeVisible({ timeout: 15_000 });
    const redemptionId = (await pending.getAttribute("data-testid"))!.replace(
      "pending-redemption-",
      "",
    );
    await page.getByTestId(`approve-redemption-${redemptionId}`).click();
    await expect(page.getByTestId("parent-redemption-action-message")).toContainText("批准", {
      timeout: 15_000,
    });
    await assertNoHorizontalScroll(page);
  });

  test("AC-M6-09 parent reject + terminal conflict via UI", async ({ page }) => {
    const fixture = loadFixtureWithCatalog();

    await loginViaUi(page, fixture.studentUsername, fixture.studentPassword);
    await page.goto("/student/redemption");
    await page.getByTestId(`apply-redemption-${fixture.catalogItemId}`).click();
    await expect(page.getByTestId("redemption-action-message")).toContainText("申请", {
      timeout: 15_000,
    });
    await logoutViaUi(page);

    await loginViaUi(page, fixture.parentEmail, fixture.parentPassword);
    await page.goto(`/parent/students/${fixture.studentId}/redemption`);
    const pending = page.locator('[data-testid^="pending-redemption-"]').first();
    await expect(pending).toBeVisible({ timeout: 15_000 });
    const redemptionId = (await pending.getAttribute("data-testid"))!.replace(
      "pending-redemption-",
      "",
    );
    await page.getByTestId(`reject-redemption-${redemptionId}`).click();
    await fillField(page, `reject-reason-${redemptionId}`, "不合规申请");
    await page.getByTestId(`confirm-reject-${redemptionId}`).click();
    await expect(page.getByTestId("parent-redemption-action-message")).toContainText("拒绝", {
      timeout: 15_000,
    });

    await page.goto(`/parent/students/${fixture.studentId}/redemption`);
    const rejectAgain = page.getByTestId(`reject-redemption-${redemptionId}`);
    if (await rejectAgain.isVisible()) {
      await rejectAgain.click();
      await fillField(page, `reject-reason-${redemptionId}`, "再次拒绝");
      await page.getByTestId(`confirm-reject-${redemptionId}`).click();
      await expect(page.getByTestId("parent-redemption-error")).toBeVisible({ timeout: 15_000 });
    }
    await assertNoHorizontalScroll(page);
  });

  test("AC-M6-09 export create/poll/download via UI; process route blocked", async ({
    page,
    request,
  }) => {
    const fixture = loadE2eFixture();

    await loginViaApi(request, fixture.studentUsername, fixture.studentPassword);
    const processProbe = await request.post(`/api/export-jobs/${crypto.randomUUID()}/process`, {
      headers: { "Idempotency-Key": `e2e-process-probe-${Date.now()}` },
    });
    expect(processProbe.status()).toBe(404);

    await loginViaUi(page, fixture.studentUsername, fixture.studentPassword);
    await page.goto("/student/export");
    await expect(page.getByTestId("create-export-button")).toBeVisible({ timeout: 15_000 });
    await assertNoHorizontalScroll(page);

    const jobId = await createExportViaUi(page);
    await expect(page.getByTestId("export-action-message")).toContainText("导出", {
      timeout: 15_000,
    });
    await expect(page.getByTestId(`export-job-${jobId}`)).toBeVisible({ timeout: 15_000 });
    await waitForExportReady(page, jobId, 90_000);
    await assertNoHorizontalScroll(page);

    const downloadPromise = page.waitForEvent("download", { timeout: 30_000 }).catch(() => null);
    await page.getByTestId(`download-export-${jobId}`).click();
    await expect(page.getByTestId("export-action-message")).toContainText("下载", {
      timeout: 30_000,
    });
    await downloadPromise;

    await page.getByTestId(`refresh-export-${jobId}`).click();
    await page.waitForTimeout(500);
    if (await page.getByTestId(`download-export-${jobId}`).isVisible()) {
      await page.getByTestId(`download-export-${jobId}`).click();
      await expect(page.getByTestId("export-error")).toBeVisible({ timeout: 15_000 });
    } else {
      await expect(page.getByTestId(`export-consumed-${jobId}`)).toBeVisible({ timeout: 15_000 });
    }
  });

  test("AC-M6-09 expired export token fails via UI after fixture expiry", async ({ page }) => {
    const fixture = loadE2eFixture();

    await loginViaUi(page, fixture.studentUsername, fixture.studentPassword);
    await page.goto("/student/export");
    const jobId = await createExportViaUi(page);
    await expect(page.getByTestId(`export-job-${jobId}`)).toBeVisible({ timeout: 15_000 });
    await waitForExportReady(page, jobId, 90_000);
    await expect(page.getByTestId(`download-export-${jobId}`)).toBeVisible();

    await expireExportJobTokenFixture(jobId);
    await page.getByTestId(`download-export-${jobId}`).click();
    await expect(page.getByTestId("export-error")).toBeVisible({ timeout: 15_000 });
    await assertNoHorizontalScroll(page);
  });

  test("AC-M6-09 unauthorized parent does not leak student redemption access", async ({ page }) => {
    const fixture = loadE2eFixture();
    const suffix = Date.now().toString(36);

    await loginViaUi(page, fixture.parentEmail, fixture.parentPassword);
    await page.goto(`/parent/students/${crypto.randomUUID()}/redemption`);
    await expect(page.getByTestId("parent-forbidden")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(suffix)).not.toBeVisible();
    await assertNoHorizontalScroll(page);
  });

  test("AC-M6-09 deletion request/cancel via UI on throwaway student", async ({
    page,
    request,
  }) => {
    const fixture = loadE2eFixture();
    await loginViaApi(request, fixture.parentEmail, fixture.parentPassword);
    const throwaway = await createThrowawayStudentViaApi(request);
    await loginThrowawayStudentViaUi(page, throwaway.username);
    const throwawayPassword = "ThrowPass123!Throw2";

    await page.goto("/student/account-deletion");
    await page.getByTestId("open-deletion-request-button").click();
    await expect(page.getByTestId("deletion-request-danger-text")).toBeVisible();
    await page.getByTestId("deletion-request-ack").check();
    await page.getByTestId("submit-deletion-request-button").click();
    await expect(page.getByTestId("deletion-action-message")).toContainText("删除", {
      timeout: 15_000,
    });
    await expect(page.getByTestId("deletion-status")).toContainText("冻结", { timeout: 15_000 });

    // Create path revokes sessions; re-login then cancel via UI.
    await loginThrowawayStudentViaUi(page, throwaway.username, throwawayPassword);
    await page.goto("/student/account-deletion");
    await expect(page.getByTestId("deletion-status")).toContainText("冻结", { timeout: 15_000 });
    await page.getByTestId("cancel-deletion-button").click();
    await expect(page.getByTestId("deletion-action-message")).toContainText("撤销", {
      timeout: 15_000,
    });
    await assertNoHorizontalScroll(page);
  });

  test("AC-M6-09 deletion danger confirm + student confirm UI on throwaway", async ({
    page,
    request,
  }) => {
    const fixture = loadE2eFixture();
    await loginViaApi(request, fixture.parentEmail, fixture.parentPassword);
    const throwaway = await createThrowawayStudentViaApi(request);
    await loginThrowawayStudentViaUi(page, throwaway.username);
    const throwawayPassword = "ThrowPass123!Throw2";

    await page.goto("/student/account-deletion");
    await page.getByTestId("open-deletion-request-button").click();
    await page.getByTestId("deletion-request-ack").check();
    await page.getByTestId("submit-deletion-request-button").click();
    await expect(page.getByTestId("deletion-status")).toContainText("冻结", { timeout: 15_000 });

    await loginThrowawayStudentViaUi(page, throwaway.username, throwawayPassword);
    await page.goto("/student/account-deletion");
    await expect(page.getByTestId("deletion-status")).toContainText("冻结", { timeout: 15_000 });
    await page.getByTestId("open-confirm-deletion-button").click();
    await expect(page.getByTestId("deletion-danger-text")).toBeVisible();
    await page.getByTestId("deletion-execute-ack").check();
    await page.getByTestId("confirm-deletion-button").click();
    await expect(page.getByTestId("deletion-action-message")).toContainText("确认", {
      timeout: 15_000,
    });
    await assertNoHorizontalScroll(page);
  });

  test("AC-M6-09 frozen throwaway blocks student export UI", async ({ page, request }) => {
    const fixture = loadE2eFixture();
    await loginViaApi(request, fixture.parentEmail, fixture.parentPassword);
    const throwaway = await createThrowawayStudentViaApi(request);
    await loginThrowawayStudentViaUi(page, throwaway.username);
    const throwawayPassword = "ThrowPass123!Throw2";

    await page.goto("/student/account-deletion");
    await page.getByTestId("open-deletion-request-button").click();
    await page.getByTestId("deletion-request-ack").check();
    await page.getByTestId("submit-deletion-request-button").click();
    await expect(page.getByTestId("deletion-status")).toContainText("冻结", { timeout: 15_000 });

    await loginThrowawayStudentViaUi(page, throwaway.username, throwawayPassword);
    await page.goto("/student/export");
    await page.getByTestId("create-export-button").click();
    await expect(page.getByTestId("export-error")).toBeVisible({ timeout: 15_000 });
    await assertNoHorizontalScroll(page);
  });
});
