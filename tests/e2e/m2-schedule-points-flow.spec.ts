import { readFileSync } from "node:fs";
import path from "node:path";

import { expect, test, type APIRequestContext, type Page, type Request } from "@playwright/test";

type Fixture = {
  parentEmail: string;
  parentPassword: string;
  studentUsername: string;
  studentPassword: string;
  studentId: string;
};

function loadFixture(): Fixture {
  const fixturePath = path.join(process.cwd(), "tests/e2e/.fixture.json");
  return JSON.parse(readFileSync(fixturePath, "utf8")) as Fixture;
}

function isMaintainHorizonPost(url: string, method: string): boolean {
  return method === "POST" && url.includes("/formal-plans/maintain-horizon");
}

async function fillField(page: Page, testId: string, value: string) {
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

async function loginViaUi(page: Page, identifier: string, password: string) {
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

async function logoutViaUi(page: Page) {
  const logoutButton = page.getByRole("button", { name: "退出" });
  if (await logoutButton.isVisible()) {
    await logoutButton.click();
    await page.waitForURL("**/login");
  }
}

async function loginViaApi(request: APIRequestContext, identifier: string, password: string) {
  const response = await request.post("/api/auth/login", {
    data: {
      identifier,
      password,
      idempotencyKey: `e2e-login-${identifier}-${Date.now()}`,
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

async function deactivateActivePlanIfAny(request: APIRequestContext, studentId: string) {
  const current = await request.get(`/api/family/students/${studentId}/formal-plans/current`);
  if (!current.ok()) return;

  const body = (await current.json()) as { plan: { planId: string } | null };
  if (!body.plan?.planId) return;

  const deactivate = await request.post(`/api/formal-plans/${body.plan.planId}/deactivate`, {
    headers: { "Idempotency-Key": `e2e-deactivate-${Date.now()}` },
  });
  expect(deactivate.ok(), await deactivate.text()).toBeTruthy();
}

async function fetchLedgerCount(request: APIRequestContext, studentId: string): Promise<number> {
  const response = await request.get(`/api/family/students/${studentId}/points/ledger?limit=50`);
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { entries: unknown[] };
  return body.entries.length;
}

async function fetchBalance(request: APIRequestContext, studentId: string): Promise<number> {
  const response = await request.get(`/api/family/students/${studentId}/points/balance`);
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { balance: number };
  return body.balance;
}

async function assertNoHorizontalScroll(page: Page) {
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
}

test.describe("M2 schedule and points flow", () => {
  test.setTimeout(180_000);

  test("AC-M2-7 full path with maintain-horizon guard and idempotent complete", async ({
    page,
    request,
  }) => {
    const fixture = loadFixture();
    const maintainPostsDuringLoad: Request[] = [];

    page.on("request", (req) => {
      if (isMaintainHorizonPost(req.url(), req.method())) {
        maintainPostsDuringLoad.push(req);
      }
    });

    await loginViaApi(request, fixture.parentEmail, fixture.parentPassword);
    await deactivateActivePlanIfAny(request, fixture.studentId);
    const balanceBeforeFlow = await fetchBalance(request, fixture.studentId);
    const ledgerBeforeFlow = await fetchLedgerCount(request, fixture.studentId);

    await loginViaUi(page, fixture.parentEmail, fixture.parentPassword);
    await page.goto(`/parent/students/${fixture.studentId}/plan`);
    await expect(page.getByTestId("create-plan-button")).toBeVisible({ timeout: 15_000 });

    await expect.poll(() => maintainPostsDuringLoad.length, { timeout: 5_000 }).toBe(0);

    await page.getByTestId("create-plan-button").click();
    await expect(page.getByTestId("plan-action-message")).toContainText("计划已创建", {
      timeout: 20_000,
    });
    await expect(page.getByText("当前计划")).toBeVisible();

    expect(maintainPostsDuringLoad.length).toBe(0);

    await page.getByTestId("enable-point-rule-button").click();
    await expect(page.getByTestId("plan-action-message")).toContainText("积分规则", {
      timeout: 15_000,
    });

    const maintainPostsBeforeClick = maintainPostsDuringLoad.length;
    const maintainResponse = page.waitForResponse(
      (resp) =>
        isMaintainHorizonPost(resp.url(), resp.request().method()) &&
        resp.request().method() === "POST",
    );
    await page.getByTestId("maintain-horizon-button").click();
    const maintainResult = await maintainResponse;
    expect(maintainResult.ok(), await maintainResult.text()).toBeTruthy();

    const maintainRequests = maintainPostsDuringLoad.slice(maintainPostsBeforeClick);
    expect(maintainRequests).toHaveLength(1);
    const maintainKey = maintainRequests[0]?.headers()["idempotency-key"];
    expect(maintainKey).toBeTruthy();
    expect(String(maintainKey).length).toBeGreaterThan(0);

    await expect(page.getByTestId("plan-action-message")).toContainText("补齐日程", {
      timeout: 15_000,
    });

    const parentPendingItem = page
      .locator('[data-testid^="schedule-item-"]')
      .filter({ hasText: "待完成" })
      .first();
    await expect(parentPendingItem).toBeVisible({ timeout: 15_000 });

    await expect(page.getByTestId("points-balance")).toHaveText(String(balanceBeforeFlow));

    if (test.info().project.name === "mobile-360") {
      await assertNoHorizontalScroll(page);
    }

    await logoutViaUi(page);

    await loginViaUi(page, fixture.studentUsername, fixture.studentPassword);
    await page.goto("/student/schedule");
    await expect(page.getByTestId(`points-today-card-${fixture.studentId}`)).toBeVisible({
      timeout: 15_000,
    });

    const pendingItem = page.locator('[data-testid^="student-schedule-item-"]').filter({
      has: page.locator('[data-testid^="complete-button-"]'),
    });
    await expect(pendingItem).toHaveCount(1, { timeout: 15_000 });

    const itemTestId = await pendingItem.getAttribute("data-testid");
    expect(itemTestId).toBeTruthy();
    const itemId = itemTestId!.replace("student-schedule-item-", "");
    const completeButton = page.getByTestId(`complete-button-${itemId}`);

    const completeResponsePromise = page.waitForResponse(
      (resp) => resp.url().includes(`/schedule-items/${itemId}/complete`) && resp.ok(),
    );
    await completeButton.click();
    const completeResponse = await completeResponsePromise;
    const completeKey = completeResponse.request().headers()["idempotency-key"];
    expect(completeKey).toBeTruthy();

    await expect(page.getByTestId("complete-action-message")).toContainText("+10", {
      timeout: 15_000,
    });
    await expect(page.getByTestId(`item-status-${itemId}`)).toHaveText("已完成");
    await expect(page.getByTestId("points-balance")).toHaveText(String(balanceBeforeFlow + 10));
    await expect(page.getByTestId("today-task-status")).toContainText("已完成");

    if (test.info().project.name === "mobile-360") {
      await assertNoHorizontalScroll(page);
    }

    await page.reload();
    await expect(page.getByTestId("points-balance")).toHaveText(String(balanceBeforeFlow + 10));
    await expect(page.getByTestId(`item-status-${itemId}`)).toHaveText("已完成");

    await logoutViaUi(page);
    await loginViaUi(page, fixture.studentUsername, fixture.studentPassword);
    await page.goto("/student/schedule");
    await expect(page.getByTestId("points-balance")).toHaveText(String(balanceBeforeFlow + 10));

    const replayResponse = await page.request.post(`/api/schedule-items/${itemId}/complete`, {
      headers: {
        "Idempotency-Key": String(completeKey),
        "Content-Type": "application/json",
      },
      data: {},
    });
    expect(replayResponse.ok(), await replayResponse.text()).toBeTruthy();
    const replayBody = (await replayResponse.json()) as { idempotentReplay: boolean };
    expect(replayBody.idempotentReplay).toBe(true);

    await loginViaApi(request, fixture.parentEmail, fixture.parentPassword);
    const balanceAfterReplay = await fetchBalance(request, fixture.studentId);
    const ledgerAfterReplay = await fetchLedgerCount(request, fixture.studentId);
    expect(balanceAfterReplay).toBe(balanceBeforeFlow + 10);
    expect(ledgerAfterReplay).toBe(ledgerBeforeFlow + 1);

    await logoutViaUi(page);
    await loginViaUi(page, fixture.parentEmail, fixture.parentPassword);
    await page.goto(`/parent/students/${fixture.studentId}/plan`);
    await expect(page.getByTestId("points-balance")).toHaveText(String(balanceBeforeFlow + 10));
    await expect(page.getByText("最近积分记录").locator("..")).toContainText("+10");

    if (test.info().project.name === "mobile-360") {
      await assertNoHorizontalScroll(page);
    }
  });
});
