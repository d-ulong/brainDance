import { eq } from "drizzle-orm";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import * as schema from "@/db/schema";
import { exportJobs } from "@/db/schema";
import { requireDatabaseUrl } from "@/lib/env";

import { fillField, loadE2eFixture } from "./ui-helpers";

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

/** Fixture-only: expire an export token so UI can assert TOKEN_EXPIRED feedback. */
export async function expireExportJobTokenFixture(jobId: string) {
  const client = postgres(requireDatabaseUrl(), { max: 1 });
  const db = drizzle(client, { schema });
  try {
    await db
      .update(exportJobs)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(exportJobs.id, jobId));
  } finally {
    await client.end({ timeout: 5 });
  }
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

/** Click the student create-export button and return the jobId from the API response. */
export async function createExportViaUi(page: Page): Promise<string> {
  return createExportViaButton(page, "create-export-button");
}

/** Click the parent create-export button and return the jobId from the API response. */
export async function createParentExportViaUi(page: Page): Promise<string> {
  return createExportViaButton(page, "parent-create-export-button");
}

async function createExportViaButton(page: Page, buttonTestId: string): Promise<string> {
  const createResponsePromise = page.waitForResponse((res) => {
    if (res.request().method() !== "POST") return false;
    const url = res.url();
    return url.includes("/api/export-jobs") && !url.includes("/download");
  });
  await page.getByTestId(buttonTestId).click();
  const createResponse = await createResponsePromise;
  expect(createResponse.ok(), await createResponse.text()).toBeTruthy();
  const body = (await createResponse.json()) as { jobId: string };
  expect(body.jobId).toBeTruthy();
  return body.jobId;
}

export async function waitForExportReady(
  page: Page,
  jobId: string,
  timeoutMs = 60_000,
  options?: { prefix?: string },
) {
  const prefix = options?.prefix ?? "";
  const status = page.getByTestId(`${prefix}export-status-${jobId}`);
  await expect(status).toBeVisible({ timeout: 15_000 });

  const deadline = Date.now() + timeoutMs;
  const refreshClickTimeoutMs = 3_000;
  while (Date.now() < deadline) {
    const download = page.getByTestId(`${prefix}download-export-${jobId}`);
    if (await download.isVisible().catch(() => false)) {
      return;
    }
    const text = (await status.textContent()) ?? "";
    if (text.includes("失败") || text.includes("已撤销") || text.includes("已过期")) {
      throw new Error(`Export job ${jobId} ended in terminal state: ${text}`);
    }
    const refresh = page.getByTestId(`${prefix}refresh-export-${jobId}`);
    if (await refresh.isVisible().catch(() => false)) {
      if (await refresh.isEnabled().catch(() => false)) {
        await refresh.click({ timeout: refreshClickTimeoutMs }).catch(() => undefined);
      }
    }
    await page.waitForTimeout(1_500);
  }

  const finalText = (await status.textContent()) ?? "";
  throw new Error(
    `Export job ${jobId} did not become ready within ${timeoutMs}ms (status: ${finalText})`,
  );
}

export async function loginThrowawayStudentViaUi(
  page: Page,
  username: string,
  password = "ThrowPass123!Throw",
) {
  await page.goto("/login");
  await fillField(page, "login-identifier", username);
  await fillField(page, "login-password", password);
  await page.getByRole("textbox", { name: "密码" }).press("Enter");
  await page.waitForTimeout(1500);

  if (page.url().includes("change-password")) {
    await fillField(page, "current-password", password);
    await fillField(page, "new-password", "ThrowPass123!Throw2");
    await page.getByRole("button", { name: "确认修改" }).click();
    await page.waitForURL((url) => !url.pathname.includes("change-password"), {
      timeout: 20_000,
    });
  }
}

/**
 * Frozen students cannot obtain a generic session (F02). They re-authenticate
 * through the narrow deletion-management capability panel on the account-deletion
 * page, which then reveals cancel/confirm actions.
 */
export async function reauthDeletionViaUi(page: Page, identifier: string, password: string) {
  await page.goto("/student/account-deletion");
  await expect(page.getByTestId("deletion-reauth-panel")).toBeVisible({ timeout: 15_000 });
  await fillField(page, "deletion-reauth-identifier", identifier);
  await fillField(page, "deletion-reauth-password", password);
  await page.getByTestId("submit-deletion-reauth-button").click();
  await expect(page.getByTestId("deletion-status")).toContainText("冻结", { timeout: 20_000 });
}
