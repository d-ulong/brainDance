import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { createVerifiedSecondParent } from "./m5-training-helpers";
import {
  createThrowawayStudentViaApi,
  loginThrowawayStudentViaUi,
  loginViaApi,
} from "./m6-lifecycle-helpers";
import { loadE2eFixture, loginViaUi } from "./ui-helpers";

async function assertNoHorizontalScroll(page: Page) {
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
}

async function switchAccount(page: Page, identifier: string, password: string) {
  await page.context().clearCookies();
  await loginViaUi(page, identifier, password);
}

function localDatetimeOffset(minutesFromNow: number): string {
  const when = new Date(Date.now() + minutesFromNow * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T${pad(when.getHours())}:${pad(when.getMinutes())}`;
}

async function createPushViaApi(
  request: APIRequestContext,
  studentId: string,
  body: {
    body?: string;
    linkUrl?: string;
    publishMode: "draft" | "immediate" | "scheduled";
    scheduledPublishAt?: string;
  },
  key: string,
) {
  const response = await request.post(`/api/family/students/${studentId}/pushes`, {
    headers: { "Idempotency-Key": key },
    data: body,
  });
  return response;
}

/** Link fixture parent to a throwaway student that was created without a relationship. */
async function linkParentToThrowawayStudent(
  request: APIRequestContext,
  input: {
    parentEmail: string;
    parentPassword: string;
    studentUsername: string;
    studentPassword: string;
    suffix: string;
  },
) {
  await loginViaApi(request, input.studentUsername, input.studentPassword);
  const codeResponse = await request.post("/api/association-codes", {
    data: { idempotencyKey: `m7-code-${input.suffix}` },
  });
  expect(codeResponse.ok(), await codeResponse.text()).toBeTruthy();
  const codePayload = (await codeResponse.json()) as { code: string };

  await loginViaApi(request, input.parentEmail, input.parentPassword);
  const linkResponse = await request.post("/api/relationship-requests", {
    data: {
      associationCode: codePayload.code,
      idempotencyKey: `m7-link-${input.suffix}`,
    },
  });
  expect(linkResponse.ok(), await linkResponse.text()).toBeTruthy();

  await loginViaApi(request, input.studentUsername, input.studentPassword);
  const pendingResponse = await request.get("/api/relationship-requests");
  expect(pendingResponse.ok(), await pendingResponse.text()).toBeTruthy();
  const pending = (await pendingResponse.json()) as {
    requests: Array<{ requestId: string }>;
  };
  const requestId = pending.requests.at(-1)?.requestId;
  expect(requestId).toBeTruthy();

  const acceptResponse = await request.post(`/api/relationship-requests/${requestId}/accept`, {
    data: { idempotencyKey: `m7-accept-${input.suffix}` },
  });
  expect(acceptResponse.ok(), await acceptResponse.text()).toBeTruthy();
}

test.describe("M7 family push P1 AC-M7-08 matrix", () => {
  test.setTimeout(240_000);

  test("text/link, answer v2, comment edit/delete, disable, no H-scroll", async ({ page }) => {
    const fixture = loadE2eFixture();
    const body = `E2E push body ${Date.now()}`;
    const link = `https://example.com/e2e-${Date.now()}`;
    const answer1 = `E2E answer1 ${Date.now()}`;
    const answer2 = `E2E answer2 ${Date.now()}`;
    const comment = `E2E comment ${Date.now()}`;
    const commentEdited = `${comment}-edited`;
    const reply = `E2E reply ${Date.now()}`;

    await loginViaUi(page, fixture.parentEmail, fixture.parentPassword);
    await page.goto(`/parent/students/${fixture.studentId}/pushes`);
    await expect(page.getByTestId("push-create-form")).toBeVisible({ timeout: 15_000 });

    await page.getByTestId("push-body-input").fill(body);
    await page.getByTestId("push-link-input").fill(link);
    await page.getByTestId("push-mode-immediate").check();

    const createResponse = page.waitForResponse(
      (resp) =>
        resp.request().method() === "POST" &&
        resp.url().includes(`/api/family/students/${fixture.studentId}/pushes`) &&
        !resp.url().includes("/answers") &&
        !resp.url().includes("/comments"),
    );
    await page.getByTestId("push-create-submit").click();
    const created = await createResponse;
    expect(created.ok(), await created.text()).toBeTruthy();
    const createdJson = (await created.json()) as { pushId: string };
    await expect(page.getByTestId(`push-body-${createdJson.pushId}`)).toContainText(body);
    await expect(page.getByTestId(`push-link-${createdJson.pushId}`)).toContainText(link);
    await assertNoHorizontalScroll(page);

    await page.getByTestId(`push-open-${createdJson.pushId}`).click();
    await expect(page.getByTestId("push-detail-body")).toContainText(body);
    await expect(page.getByTestId("push-detail-link")).toContainText(link);

    await switchAccount(page, fixture.studentUsername, fixture.studentPassword);
    await page.goto("/student/pushes");
    await expect(page.getByTestId(`student-push-open-${createdJson.pushId}`)).toBeVisible({
      timeout: 15_000,
    });
    await page.getByTestId(`student-push-open-${createdJson.pushId}`).click();
    await expect(page.getByTestId("student-push-body")).toContainText(body);
    await expect(page.getByTestId("student-push-link")).toContainText(link);

    await page.getByTestId("student-answer-input").fill(answer1);
    const answerResponse = page.waitForResponse(
      (resp) => resp.request().method() === "POST" && resp.url().includes("/answers"),
    );
    await page.getByTestId("student-answer-submit").click();
    expect((await answerResponse).ok()).toBeTruthy();
    await expect(page.getByTestId("student-answer-current")).toContainText(answer1);

    await page.getByTestId("student-answer-input").fill(answer2);
    const answer2Response = page.waitForResponse(
      (resp) => resp.request().method() === "POST" && resp.url().includes("/answers"),
    );
    await page.getByTestId("student-answer-submit").click();
    expect((await answer2Response).ok()).toBeTruthy();
    await expect(page.getByTestId("student-answer-current")).toContainText(answer2);
    await expect(page.getByTestId("student-answer-current")).toContainText("v2");

    await page.getByTestId("student-comment-input").fill(reply);
    const replyResponse = page.waitForResponse(
      (resp) => resp.request().method() === "POST" && resp.url().includes("/comments"),
    );
    await page.getByTestId("student-comment-submit").click();
    expect((await replyResponse).ok()).toBeTruthy();
    await assertNoHorizontalScroll(page);

    await switchAccount(page, fixture.parentEmail, fixture.parentPassword);
    await page.goto(`/parent/students/${fixture.studentId}/pushes/${createdJson.pushId}`);
    await expect(page.getByTestId("push-answer-body")).toContainText(answer2, { timeout: 15_000 });

    const commentResponse = page.waitForResponse(
      (resp) => resp.request().method() === "POST" && resp.url().includes("/comments"),
    );
    await page.getByTestId("push-comment-input").fill(comment);
    await page.getByTestId("push-comment-submit").click();
    expect((await commentResponse).ok()).toBeTruthy();
    await expect(page.getByText(comment)).toBeVisible();

    const commentRow = page.locator('[data-testid^="comment-body-"]').filter({ hasText: comment });
    await expect(commentRow).toBeVisible();
    const commentBodyTestId = await commentRow.getAttribute("data-testid");
    expect(commentBodyTestId).toBeTruthy();
    const commentId = commentBodyTestId!.replace("comment-body-", "");

    page.once("dialog", async (dialog) => {
      await dialog.accept(commentEdited);
    });
    const editResponse = page.waitForResponse(
      (resp) =>
        resp.request().method() === "PATCH" &&
        resp.url().includes(`/comments/${commentId}`) &&
        resp.ok(),
    );
    await page.getByTestId(`comment-edit-${commentId}`).click();
    await editResponse;
    await expect(page.getByTestId(`comment-body-${commentId}`)).toContainText(commentEdited);

    const deleteResponse = page.waitForResponse(
      (resp) =>
        resp.request().method() === "PATCH" &&
        resp.url().includes(`/comments/${commentId}`) &&
        resp.ok(),
    );
    await page.getByTestId(`comment-delete-${commentId}`).click();
    await deleteResponse;
    await expect(page.getByTestId(`comment-deleted-${commentId}`)).toContainText("评论已删除");

    await page.getByTestId("push-disable").click();
    await expect(page.getByTestId("push-detail-status")).toContainText("已停用");
    await assertNoHorizontalScroll(page);
  });

  test("schedule create/publish visibility + schedule failure feedback", async ({ page }) => {
    const fixture = loadE2eFixture();
    const body = `E2E scheduled ${Date.now()}`;
    const link = `https://example.com/sched-${Date.now()}`;

    await loginViaUi(page, fixture.parentEmail, fixture.parentPassword);
    await page.goto(`/parent/students/${fixture.studentId}/pushes`);
    await expect(page.getByTestId("push-create-form")).toBeVisible({ timeout: 15_000 });

    // Failure: scheduled mode without a valid future time.
    await page.getByTestId("push-body-input").fill(body);
    await page.getByTestId("push-mode-scheduled").check();
    await page.getByTestId("push-create-submit").click();
    await expect(page.getByTestId("push-error")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("push-create-form")).toBeVisible();
    await assertNoHorizontalScroll(page);

    await page.getByTestId("push-link-input").fill(link);
    await page.getByTestId("push-schedule-input").fill(localDatetimeOffset(120));

    const createResponse = page.waitForResponse(
      (resp) =>
        resp.request().method() === "POST" &&
        resp.url().includes(`/api/family/students/${fixture.studentId}/pushes`) &&
        !resp.url().includes("/answers") &&
        !resp.url().includes("/comments"),
    );
    await page.getByTestId("push-create-submit").click();
    const created = await createResponse;
    expect(created.ok(), await created.text()).toBeTruthy();
    const createdJson = (await created.json()) as { pushId: string };
    await expect(page.getByTestId(`push-status-${createdJson.pushId}`)).toContainText("已预约");
    await expect(page.getByTestId(`push-body-${createdJson.pushId}`)).toContainText(body);
    await expect(page.getByTestId(`push-link-${createdJson.pushId}`)).toContainText(link);

    await page.getByTestId(`push-open-${createdJson.pushId}`).click();
    await expect(page.getByTestId("push-detail-status")).toContainText("已预约");
    await page.getByTestId("push-publish").click();
    await expect(page.getByTestId("push-detail-status")).toContainText("已发布", {
      timeout: 15_000,
    });

    await switchAccount(page, fixture.studentUsername, fixture.studentPassword);
    await page.goto("/student/pushes");
    await expect(page.getByTestId(`student-push-open-${createdJson.pushId}`)).toBeVisible({
      timeout: 15_000,
    });
    await page.getByTestId(`student-push-open-${createdJson.pushId}`).click();
    await expect(page.getByTestId("student-push-body")).toContainText(body);
    await expect(page.getByTestId("student-push-link")).toContainText(link);
    await assertNoHorizontalScroll(page);
  });

  test("non-creator write reject, terminal conflict, delete confirm", async ({ page, request }) => {
    const fixture = loadE2eFixture();
    const suffix = `${Date.now()}`;
    const parent2 = await createVerifiedSecondParent(request, fixture, suffix);

    await loginViaApi(request, fixture.parentEmail, fixture.parentPassword);
    const created = await createPushViaApi(
      request,
      fixture.studentId,
      {
        body: `owned-${suffix}`,
        linkUrl: `https://example.com/owned-${suffix}`,
        publishMode: "immediate",
      },
      `e2e-owned-${suffix}`,
    );
    expect(created.ok(), await created.text()).toBeTruthy();
    const { pushId } = (await created.json()) as { pushId: string };

    await loginViaApi(request, parent2.email, parent2.password);
    const forbiddenDisable = await request.post(
      `/api/family/students/${fixture.studentId}/pushes/${pushId}/disable`,
      {
        headers: { "Idempotency-Key": `e2e-other-disable-${suffix}` },
        data: {},
      },
    );
    expect(forbiddenDisable.status()).toBe(403);

    await loginViaUi(page, parent2.email, parent2.password);
    await page.goto(`/parent/students/${fixture.studentId}/pushes/${pushId}`);
    await expect(page.getByTestId("push-detail-status")).toContainText("只读", {
      timeout: 15_000,
    });
    await expect(page.getByTestId("push-disable")).toHaveCount(0);
    await expect(page.getByTestId("push-delete")).toHaveCount(0);
    await assertNoHorizontalScroll(page);

    await switchAccount(page, fixture.parentEmail, fixture.parentPassword);
    await page.goto(`/parent/students/${fixture.studentId}/pushes/${pushId}`);
    await expect(page.getByTestId("push-delete")).toBeVisible();
    await page.getByTestId("push-delete").click();
    await expect(page.getByTestId("push-delete")).toContainText("再次点击确认删除");
    const deleteResponse = page.waitForResponse(
      (resp) =>
        resp.request().method() === "DELETE" &&
        resp.url().includes(`/pushes/${pushId}`) &&
        resp.ok(),
    );
    await page.getByTestId("push-delete").click();
    await deleteResponse;
    await expect(page).toHaveURL(new RegExp(`/parent/students/${fixture.studentId}/pushes$`));

    await loginViaApi(request, fixture.parentEmail, fixture.parentPassword);
    const terminal = await request.post(
      `/api/family/students/${fixture.studentId}/pushes/${pushId}/publish`,
      {
        headers: { "Idempotency-Key": `e2e-terminal-${suffix}` },
        data: {},
      },
    );
    expect([404, 409]).toContain(terminal.status());
    const terminalBody = await terminal.text();
    expect(terminalBody.length).toBeGreaterThan(0);
  });

  test("freeze and unlink revoke write/access with recoverable feedback", async ({
    page,
    request,
  }) => {
    const fixture = loadE2eFixture();
    const suffix = `${Date.now()}`;
    const throwawayPassword = "ThrowPass123!Throw2";

    await loginViaApi(request, fixture.parentEmail, fixture.parentPassword);
    const throwaway = await createThrowawayStudentViaApi(request);

    // Controlled-student create does not open a relationship; link before freeze.
    await loginThrowawayStudentViaUi(page, throwaway.username);
    await linkParentToThrowawayStudent(request, {
      parentEmail: fixture.parentEmail,
      parentPassword: fixture.parentPassword,
      studentUsername: throwaway.username,
      studentPassword: throwawayPassword,
      suffix: `freeze-${suffix}`,
    });

    await switchAccount(page, throwaway.username, throwawayPassword);
    await page.goto("/student/account-deletion");
    await page.getByTestId("open-deletion-request-button").click();
    await page.getByTestId("deletion-request-ack").check();
    await page.getByTestId("submit-deletion-request-button").click();
    await expect(page.getByTestId("deletion-status")).toContainText("冻结", { timeout: 15_000 });

    await loginViaApi(request, fixture.parentEmail, fixture.parentPassword);
    const frozenCreate = await createPushViaApi(
      request,
      throwaway.studentId,
      {
        body: `frozen-${suffix}`,
        publishMode: "immediate",
      },
      `e2e-freeze-create-${suffix}`,
    );
    expect(frozenCreate.status()).toBe(400);
    const frozenText = await frozenCreate.text();
    expect(frozenText.toLowerCase()).toMatch(/frozen|冻结/);

    await switchAccount(page, fixture.parentEmail, fixture.parentPassword);
    await page.goto(`/parent/students/${throwaway.studentId}/pushes`);
    await expect(page.getByTestId("push-error")).toBeVisible({ timeout: 15_000 });
    await assertNoHorizontalScroll(page);

    // Unlink a second parent (not the fixture parent) so shared fixture stays usable.
    const parent2 = await createVerifiedSecondParent(request, fixture, `ul-${suffix}`);
    await loginViaApi(request, parent2.email, parent2.password);
    const scheduled = await createPushViaApi(
      request,
      fixture.studentId,
      {
        body: `unlink-sched-${suffix}`,
        publishMode: "scheduled",
        scheduledPublishAt: new Date(Date.now() + 3_600_000).toISOString(),
      },
      `e2e-unlink-sched-${suffix}`,
    );
    expect(scheduled.ok(), await scheduled.text()).toBeTruthy();
    const scheduledJson = (await scheduled.json()) as { pushId: string };

    await switchAccount(page, parent2.email, parent2.password);
    await page.goto(`/parent/students/${fixture.studentId}/training`);
    await expect(page.getByRole("button", { name: "解除关联" })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "解除关联" }).click();
    await expect(page.getByTestId("parent-forbidden")).toBeVisible({ timeout: 15_000 });

    const denied = await request.get(
      `/api/family/students/${fixture.studentId}/pushes/${scheduledJson.pushId}`,
    );
    expect([401, 403, 404]).toContain(denied.status());

    await switchAccount(page, fixture.parentEmail, fixture.parentPassword);
    await page.goto(`/parent/students/${fixture.studentId}/pushes`);
    await expect(page.getByTestId("push-create-form")).toBeVisible({ timeout: 15_000 });
    // Cancelled scheduled pushes are not listed for remaining parents.
    await expect(page.getByTestId(`push-status-${scheduledJson.pushId}`)).toHaveCount(0);
    await assertNoHorizontalScroll(page);
  });
});
