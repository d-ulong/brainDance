import { readFileSync } from "node:fs";
import path from "node:path";

import { expect, type Page } from "@playwright/test";

export type E2eFixture = {
  adminEmail: string;
  adminPassword: string;
  parentEmail: string;
  parentPassword: string;
  parentId?: string;
  studentUsername: string;
  studentPassword: string;
  studentId: string;
};

const FIXTURE_PATH = path.join(process.cwd(), "tests/e2e/.fixture.json");

export function loadE2eFixture(): E2eFixture {
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as E2eFixture;
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
  await page.getByRole("textbox", { name: "密码" }).press("Enter");
  const response = await loginResponse;
  expect(response.ok(), await response.text()).toBeTruthy();

  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20_000 });
}

export async function logoutViaUi(page: Page) {
  const logoutButton = page.getByRole("button", { name: "退出" });
  if (await logoutButton.isVisible()) {
    await logoutButton.click();
    await page.waitForURL("**/login");
  }
}
