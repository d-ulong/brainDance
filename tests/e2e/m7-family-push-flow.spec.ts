import { expect, test, type Page } from "@playwright/test";

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

test.describe("M7 family push P1 flow", () => {
  test.setTimeout(180_000);

  test("text/link publish, answer, comment loop on desktop/mobile", async ({ page }) => {
    const fixture = loadE2eFixture();
    const body = `E2E push body ${Date.now()}`;
    const link = `https://example.com/e2e-${Date.now()}`;
    const answer = `E2E answer ${Date.now()}`;
    const comment = `E2E comment ${Date.now()}`;
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

    await switchAccount(page, fixture.studentUsername, fixture.studentPassword);
    await page.goto("/student/pushes");
    await expect(page.getByTestId(`student-push-open-${createdJson.pushId}`)).toBeVisible({
      timeout: 15_000,
    });
    await page.getByTestId(`student-push-open-${createdJson.pushId}`).click();
    await expect(page.getByTestId("student-push-body")).toContainText(body);
    await expect(page.getByTestId("student-push-link")).toContainText(link);

    await page.getByTestId("student-answer-input").fill(answer);
    const answerResponse = page.waitForResponse(
      (resp) => resp.request().method() === "POST" && resp.url().includes("/answers"),
    );
    await page.getByTestId("student-answer-submit").click();
    expect((await answerResponse).ok()).toBeTruthy();
    await expect(page.getByTestId("student-answer-current")).toContainText(answer);

    await page.getByTestId("student-comment-input").fill(reply);
    const replyResponse = page.waitForResponse(
      (resp) => resp.request().method() === "POST" && resp.url().includes("/comments"),
    );
    await page.getByTestId("student-comment-submit").click();
    expect((await replyResponse).ok()).toBeTruthy();
    await assertNoHorizontalScroll(page);

    await switchAccount(page, fixture.parentEmail, fixture.parentPassword);
    await page.goto(`/parent/students/${fixture.studentId}/pushes/${createdJson.pushId}`);
    await expect(page.getByTestId("push-answer-body")).toContainText(answer, { timeout: 15_000 });
    await page.getByTestId("push-comment-input").fill(comment);
    const commentResponse = page.waitForResponse(
      (resp) => resp.request().method() === "POST" && resp.url().includes("/comments"),
    );
    await page.getByTestId("push-comment-submit").click();
    expect((await commentResponse).ok()).toBeTruthy();
    await expect(page.getByText(comment)).toBeVisible();
    await assertNoHorizontalScroll(page);

    // Ownership: delete requires explicit confirmation.
    await page.getByTestId("push-disable").click();
    await expect(page.getByTestId("push-detail-status")).toContainText("已停用");
  });
});
