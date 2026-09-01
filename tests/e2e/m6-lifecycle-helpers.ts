import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { loadE2eFixture } from "./ui-helpers";

export async function assertNoHorizontalScroll(page: Page) {
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
}

export async function loginViaApi(
  request: APIRequestContext,
  identifier: string,
  password: string,
) {
  const response = await request.post("/api/auth/login", {
    data: {
      identifier,
      password,
      idempotencyKey: `e2e-login-${identifier}-${Date.now()}`,
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

export async function createRedemptionViaApi(
  request: APIRequestContext,
  studentId: string,
  catalogItemId: string,
) {
  const response = await request.post(`/api/family/students/${studentId}/redemptions`, {
    headers: { "Idempotency-Key": `e2e-redemption-${Date.now()}` },
    data: { catalogItemId },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as { redemption: { id: string; status: string } };
}

export async function approveRedemptionViaApi(
  request: APIRequestContext,
  studentId: string,
  redemptionId: string,
) {
  const response = await request.post(
    `/api/family/students/${studentId}/redemptions/${redemptionId}/approve`,
    { headers: { "Idempotency-Key": `e2e-approve-${Date.now()}` } },
  );
  expect(response.ok(), await response.text()).toBeTruthy();
}

export async function createExportJobViaApi(request: APIRequestContext, studentId: string) {
  const response = await request.post("/api/export-jobs", {
    headers: { "Idempotency-Key": `e2e-export-${Date.now()}` },
    data: { studentId },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as { jobId: string; status: string };
}

export async function processExportJobViaApi(request: APIRequestContext, jobId: string) {
  const response = await request.post(`/api/export-jobs/${jobId}/process`, {
    headers: { "Idempotency-Key": `e2e-process-export-${Date.now()}` },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as {
    jobId: string;
    status: string;
    downloadTokenPlaintext?: string;
  };
}

export async function downloadExportViaApi(
  request: APIRequestContext,
  jobId: string,
  token: string,
) {
  return request.post(`/api/export-jobs/${jobId}/download`, {
    data: { token },
  });
}

export async function createDeletionRequestViaApi(request: APIRequestContext, studentId: string) {
  const response = await request.post("/api/deletion-requests", {
    headers: { "Idempotency-Key": `e2e-deletion-${Date.now()}` },
    data: { targetType: "student_account", targetId: studentId },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as { requestId: string; status: string };
}

export async function cancelDeletionRequestViaApi(request: APIRequestContext, requestId: string) {
  const response = await request.delete(`/api/deletion-requests/${requestId}`, {
    headers: { "Idempotency-Key": `e2e-cancel-deletion-${Date.now()}` },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

export async function createThrowawayStudentViaApi(request: APIRequestContext) {
  const suffix = Date.now().toString(36);
  const response = await request.post("/api/family/students", {
    headers: { "Idempotency-Key": `e2e-throwaway-${suffix}` },
    data: {
      username: `throw_${suffix}`,
      birthDate: "2014-01-01",
      displayName: "Throwaway Student",
      initialPassword: "ThrowPass123!Throw",
      idempotencyKey: `e2e-throwaway-body-${suffix}`,
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as { studentId: string; username: string };
}

export function loadFixtureWithCatalog() {
  const fixture = loadE2eFixture() as ReturnType<typeof loadE2eFixture> & {
    catalogItemId?: string;
  };
  expect(fixture.catalogItemId, "E2E fixture must include catalogItemId").toBeTruthy();
  return fixture;
}
