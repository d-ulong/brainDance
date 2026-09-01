import { expect, test } from "@playwright/test";

import {
  approveRedemptionViaApi,
  assertNoHorizontalScroll,
  createDeletionRequestViaApi,
  createExportJobViaApi,
  createRedemptionViaApi,
  createThrowawayStudentViaApi,
  downloadExportViaApi,
  loadFixtureWithCatalog,
  loginViaApi,
  processExportJobViaApi,
} from "./m6-lifecycle-helpers";
import { loadE2eFixture, loginViaUi, logoutViaUi } from "./ui-helpers";

test.describe("M6 lifecycle flow", () => {
  test.setTimeout(180_000);

  test("AC-M6-09 redemption main path with idempotency and no horizontal scroll", async ({
    page,
  }) => {
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
    await assertNoHorizontalScroll(page);
    await logoutViaUi(page);

    await loginViaUi(page, fixture.parentEmail, fixture.parentPassword);
    await page.goto(`/parent/students/${fixture.studentId}/redemption`);
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

  test("AC-M6-09 export create/process/download and consumed token rejection", async ({
    page,
    request,
  }) => {
    const fixture = loadE2eFixture();

    await loginViaUi(page, fixture.studentUsername, fixture.studentPassword);
    await page.goto("/student/export");
    await expect(page.getByTestId("create-export-button")).toBeVisible({ timeout: 15_000 });
    await assertNoHorizontalScroll(page);
    await logoutViaUi(page);

    await loginViaApi(request, fixture.studentUsername, fixture.studentPassword);
    const created = await createExportJobViaApi(request, fixture.studentId);
    const processed = await processExportJobViaApi(request, created.jobId);
    expect(processed.downloadTokenPlaintext).toBeTruthy();

    const firstDownload = await downloadExportViaApi(
      request,
      created.jobId,
      processed.downloadTokenPlaintext!,
    );
    expect(firstDownload.ok(), await firstDownload.text()).toBeTruthy();

    const secondDownload = await downloadExportViaApi(
      request,
      created.jobId,
      processed.downloadTokenPlaintext!,
    );
    expect(secondDownload.status()).toBe(400);
    const secondBody = (await secondDownload.json()) as { error: { code?: string } };
    expect(secondBody.error.code).toBe("TOKEN_CONSUMED");
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

  test("AC-M6-09 terminal state conflict on double approve", async ({ request }) => {
    const fixture = loadFixtureWithCatalog();

    await loginViaApi(request, fixture.studentUsername, fixture.studentPassword);
    const redemption = await createRedemptionViaApi(
      request,
      fixture.studentId,
      fixture.catalogItemId!,
    );
    await loginViaApi(request, fixture.parentEmail, fixture.parentPassword);
    await approveRedemptionViaApi(request, fixture.studentId, redemption.redemption.id);

    const conflict = await request.post(
      `/api/family/students/${fixture.studentId}/redemptions/${redemption.redemption.id}/approve`,
      { headers: { "Idempotency-Key": `e2e-approve-conflict-${Date.now()}` } },
    );
    expect(conflict.status()).toBe(409);
  });

  test("AC-M6-09 deletion danger confirm UI without freezing main fixture", async ({ page }) => {
    const fixture = loadE2eFixture();

    await loginViaUi(page, fixture.studentUsername, fixture.studentPassword);
    await page.goto("/student/account-deletion");
    await page.getByTestId("open-deletion-request-button").click();
    await expect(page.getByTestId("deletion-request-danger-text")).toBeVisible();
    await page.getByTestId("deletion-request-ack").check();
    await expect(page.getByTestId("submit-deletion-request-button")).toBeEnabled();
    await assertNoHorizontalScroll(page);
  });

  test("AC-M6-09 frozen state blocks API access for throwaway student", async ({ request }) => {
    const fixture = loadE2eFixture();
    await loginViaApi(request, fixture.parentEmail, fixture.parentPassword);
    const throwaway = await createThrowawayStudentViaApi(request);

    await loginViaApi(request, fixture.adminEmail, fixture.adminPassword);
    await createDeletionRequestViaApi(request, throwaway.studentId);

    const scheduleResponse = await request.get(
      `/api/family/students/${throwaway.studentId}/schedule-items?from=2020-01-01&to=2030-01-01`,
    );
    expect(scheduleResponse.status()).toBeGreaterThanOrEqual(400);
  });

  test("AC-M6-09 invalid export download token is rejected", async ({ request }) => {
    const fixture = loadE2eFixture();
    await loginViaApi(request, fixture.studentUsername, fixture.studentPassword);
    const created = await createExportJobViaApi(request, fixture.studentId);
    await processExportJobViaApi(request, created.jobId);

    const badDownload = await downloadExportViaApi(request, created.jobId, "invalid-token-value");
    expect(badDownload.status()).toBeGreaterThanOrEqual(400);
    const body = (await badDownload.json()) as { error: { code?: string } };
    expect(body.error.code).toMatch(/TOKEN_INVALID|NOT_FOUND/);
  });
});
