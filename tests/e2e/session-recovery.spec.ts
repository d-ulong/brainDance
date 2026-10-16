import { expect, test } from "@playwright/test";

const studentSession = {
  userId: "09999999-0000-4000-8000-000000000002",
  role: "student",
  displayName: "网络恢复测试学生",
  account: "session_recovery_student",
  contactVerified: true,
  mustChangePassword: false,
};

for (const path of [
  "/",
  "/account",
  "/register",
  "/admin/invitations",
  "/student/change-password",
  "/parent/change-password",
  "/parent/link",
  "/parent/students/new",
  "/verify-contact",
  "/student/training",
  "/parent/schedule",
]) {
  test(`session transport failure stays on ${path} and offers retry`, async ({ page }) => {
    test.setTimeout(60_000);
    const unhandled: string[] = [];
    page.on("pageerror", (error) => unhandled.push(error.message));
    await page.route("**/api/auth/session", (route) => route.abort("failed"));
    // A cold development route can render its server loading view before its
    // client bundle hydrates. Start the error-UI assertion after fault injection.
    const sessionFailure = page.waitForEvent("requestfailed", {
      predicate: (request) => new URL(request.url()).pathname === "/api/auth/session",
      timeout: 30_000,
    });
    await Promise.all([page.goto(path), sessionFailure]);
    expect(unhandled, "Client errors before the failed session request").toEqual([]);
    await expect(
      page.getByTestId("session-load-error"),
      "The rejected session request must leave the loading state",
    ).toBeVisible();
    await expect(page.getByTestId("session-retry")).toBeEnabled();
    expect(new URL(page.url()).pathname).toBe(path);
    expect(unhandled).toEqual([]);
  });
}

test("account and shared navigation recover after a failed session request", async ({ page }) => {
  let recovered = false;
  await page.route("**/api/auth/session", (route) =>
    recovered ? route.fulfill({ json: studentSession }) : route.abort("failed"),
  );
  await page.goto("/account");
  await expect(page.getByTestId("session-load-error")).toBeVisible();
  recovered = true;
  await page.getByTestId("session-retry").click();
  await expect(page.getByTestId("account-name")).toHaveText(studentSession.displayName);
  await expect(page.getByTestId("top-tabs")).toBeVisible();
  await expect(page.getByTestId("top-tabs-loading")).toHaveCount(0);
  await expect(page.getByTestId("session-load-error")).toHaveCount(0);
});

test("register retry resolves a real 401 and enables the registration form", async ({ page }) => {
  let recovered = false;
  await page.route("**/api/auth/session", (route) =>
    recovered
      ? route.fulfill({ status: 401, json: { error: "UNAUTHORIZED" } })
      : route.abort("failed"),
  );
  await page.goto("/register");
  await expect(page.getByTestId("session-load-error")).toBeVisible();
  recovered = true;
  await page.getByTestId("session-retry").click();
  await expect(page.getByTestId("register-submit")).toBeEnabled();
  await expect(page.getByTestId("session-load-error")).toHaveCount(0);
});

test("training preparation can retry authentication without creating a session early", async ({
  page,
}) => {
  let recovered = false;
  let starts = 0;
  await page.route("**/api/auth/session", (route) =>
    recovered ? route.fulfill({ json: studentSession }) : route.abort("failed"),
  );
  await page.route("**/api/training/sessions", (route) => {
    starts += 1;
    return route.abort("failed");
  });
  await page.goto("/student/training/reaction");
  await expect(page.getByRole("button", { name: "重新准备训练" })).toBeVisible();
  expect(starts).toBe(0);
  recovered = true;
  await page.getByRole("button", { name: "重新准备训练" }).click();
  await expect(page.getByTestId("reaction-intro")).toBeVisible();
  expect(starts).toBe(0);
});
