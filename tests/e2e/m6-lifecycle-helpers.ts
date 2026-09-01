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

/** Click create-export and return the jobId from the create API response. */
export async function createExportViaUi(page: Page): Promise<string> {
  const createResponsePromise = page.waitForResponse((res) => {
    if (res.request().method() !== "POST") return false;
    const url = res.url();
    return url.includes("/api/export-jobs") && !url.includes("/download");
  });
  await page.getByTestId("create-export-button").click();
  const createResponse = await createResponsePromise;
  expect(createResponse.ok(), await createResponse.text()).toBeTruthy();
  const body = (await createResponse.json()) as { jobId: string };
  expect(body.jobId).toBeTruthy();
  return body.jobId;
}

export async function waitForExportReady(page: Page, jobId: string, timeoutMs = 60_000) {
  const status = page.getByTestId(`export-status-${jobId}`);
  await expect(status).toBeVisible({ timeout: 15_000 });

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const download = page.getByTestId(`download-export-${jobId}`);
    if (await download.isVisible().catch(() => false)) {
      return;
    }
    const text = (await status.textContent()) ?? "";
    if (text.includes("失败") || text.includes("已撤销") || text.includes("已过期")) {
      throw new Error(`Export job ${jobId} ended in terminal state: ${text}`);
    }
    const refresh = page.getByTestId(`refresh-export-${jobId}`);
    if (await refresh.isVisible().catch(() => false)) {
      await refresh.click();
    }
    await page.waitForTimeout(1_500);
  }

  await expect(page.getByTestId(`download-export-${jobId}`)).toBeVisible({ timeout: 1_000 });
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
