import { expect, test } from "@playwright/test";

test.describe("training shell leave guard", () => {
  test("avatar navigation asks before leaving active reaction training", async ({ page }) => {
    let cancelCalls = 0;
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() === "GET" && url.pathname === "/api/auth/session") {
        return route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            userId: "sample-student",
            role: "student",
            displayName: "示例学生",
            account: "sample",
            contactVerified: true,
            mustChangePassword: false,
          }),
        });
      }
      if (request.method() === "POST" && url.pathname === "/api/training/sessions") {
        return route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            sessionId: "session-leave-guard",
            trainingKey: "reaction",
            definitionVersion: 1,
            ageBand: "9-12",
            familyDate: "2026-09-19",
            expectedTrialCount: 16,
            status: "active",
            idempotentReplay: false,
          }),
        });
      }
      if (request.method() === "POST" && url.pathname.endsWith("/terminate")) {
        cancelCalls += 1;
        return route.fulfill({ contentType: "application/json", body: JSON.stringify({ status: "cancelled" }) });
      }
      if (request.method() === "GET") {
        return route.fulfill({ contentType: "application/json", body: JSON.stringify({}) });
      }
      return route.fulfill({ status: 409, body: JSON.stringify({ error: "blocked" }) });
    });

    page.on("dialog", async (dialog) => {
      expect(dialog.message()).toContain("离开训练");
      await dialog.dismiss();
    });
    await page.goto("/student/training/reaction");
    await page.getByTestId("reaction-start").click();
    await page.getByTestId("training-target").waitFor();
    await page.getByTestId("shell-account-link").click();
    await expect(page).toHaveURL(/\/student\/training\/reaction/);
    expect(cancelCalls).toBe(0);

    page.removeAllListeners("dialog");
    page.once("dialog", async (dialog) => {
      expect(dialog.message()).toContain("离开训练");
      await dialog.accept();
    });
    await page.getByTestId("shell-account-link").click();
    await expect(page).toHaveURL(/\/account/);
    expect(cancelCalls).toBe(1);
  });
});
