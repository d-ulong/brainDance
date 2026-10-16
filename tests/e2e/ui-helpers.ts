import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { totpForStep } from "@/modules/identity/totp";

export type E2eFixture = {
  adminEmail: string;
  adminPassword: string;
  adminTotpSecret: string;
  adminTotpLastStep?: number;
  parentEmail: string;
  parentPassword: string;
  parentId?: string;
  studentUsername: string;
  studentPassword: string;
  studentId: string;
  secondStudentId?: string;
};

const FIXTURE_PATH = path.join(process.cwd(), "tests/e2e/.fixture.json");

export function loadE2eFixture(): E2eFixture {
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as E2eFixture;
}

async function nextAdminTotpCode(identifier: string): Promise<string> {
  const fixture = loadE2eFixture();
  if (identifier !== fixture.adminEmail || !fixture.adminTotpSecret)
    throw new Error("Missing E2E admin TOTP fixture");
  let step = Math.floor(Date.now() / 30_000);
  // Playwright uses one worker. Persist the consumed step across test-file worker restarts.
  if (step <= (fixture.adminTotpLastStep ?? -1)) {
    await new Promise((resolve) =>
      setTimeout(resolve, (fixture.adminTotpLastStep! + 1) * 30_000 - Date.now() + 100),
    );
    step = Math.floor(Date.now() / 30_000);
  }
  writeFileSync(FIXTURE_PATH, JSON.stringify({ ...fixture, adminTotpLastStep: step }, null, 2));
  return totpForStep(fixture.adminTotpSecret, step);
}

export async function loginViaApi(
  request: APIRequestContext,
  identifier: string,
  password: string,
) {
  let response = await request.post("/api/auth/login", { data: { identifier, password } });
  expect(response.ok(), await response.text()).toBeTruthy();
  if ((await response.json()).mfaRequired) {
    response = await request.post("/api/auth/login", {
      data: { identifier, password, totpCode: await nextAdminTotpCode(identifier) },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    expect((await response.json()).mfaRequired).not.toBe(true);
  }
}

export async function completeAdminMfaViaUi(page: Page, identifier: string) {
  await fillField(page, "login-totp", await nextAdminTotpCode(identifier));
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/api/auth/login") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "验证并登录" }).click();
  const response = await responsePromise;
  expect(response.ok(), await response.text()).toBeTruthy();
  expect((await response.json()).mfaRequired).not.toBe(true);
}

export async function fillField(page: Page, testId: string, value: string) {
  const input = page.getByTestId(testId);
  await expect(input).toBeVisible();
  await input.click();
  const inputType = await input.getAttribute("type");
  if (inputType === "date") {
    await input.fill(value);
  } else {
    await input.fill("");
    await input.pressSequentially(value, { delay: 15 });
  }
  await expect(input).toHaveValue(value);
}

export async function loginViaUi(page: Page, identifier: string, password: string) {
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "登录" })).toBeEnabled();
  await fillField(page, "login-identifier", identifier);
  await fillField(page, "login-password", password);

  const loginResponse = page.waitForResponse(
    (resp) => resp.url().includes("/api/auth/login") && resp.request().method() === "POST",
  );
  await page.getByTestId("login-password").press("Enter");
  const response = await loginResponse;
  expect(response.ok(), await response.text()).toBeTruthy();

  if ((await response.json()).mfaRequired) await completeAdminMfaViaUi(page, identifier);

  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20_000 });
}

export async function logoutViaUi(page: Page) {
  const logoutButton = page.getByRole("button", { name: "退出" });
  await expect(logoutButton).toBeVisible();
  await logoutButton.click();
  await page.waitForURL("**/login");
}
