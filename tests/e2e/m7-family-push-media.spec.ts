import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";

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

async function writeTempPng(): Promise<string> {
  const filePath = path.join(os.tmpdir(), `m7-p2-${crypto.randomUUID()}.png`);
  const buf = await sharp({
    create: { width: 48, height: 48, channels: 3, background: { r: 40, g: 140, b: 220 } },
  })
    .png()
    .toBuffer();
  fs.writeFileSync(filePath, buf);
  return filePath;
}

test.describe("M7 family push P2 AC-M7-05 media matrix", () => {
  test("image push + image answer + reject bad file + delete unreadability", async ({
    page,
  }, testInfo) => {
    const fixture = loadE2eFixture();
    const pngPath = await writeTempPng();
    const badPath = path.join(os.tmpdir(), `m7-p2-bad-${crypto.randomUUID()}.txt`);
    fs.writeFileSync(badPath, "not-an-image");

    await loginViaUi(page, fixture.parentEmail, fixture.parentPassword);
    await page.goto(`/parent/students/${fixture.studentId}/pushes`);
    await expect(page.getByTestId("push-create-form")).toBeVisible();

    const body = `P2 image push ${testInfo.project.name} ${Date.now()}`;
    await page.getByTestId("push-body-input").fill(body);
    await page.getByTestId("push-image-input").setInputFiles(pngPath);
    await page.getByTestId("push-mode-immediate").check();
    await page.getByTestId("push-create-submit").click();
    await expect(page.getByTestId("push-list")).toContainText(body, { timeout: 30_000 });

    const openLink = page.locator('[data-testid^="push-open-"]').filter({ hasText: "查看详情" }).first();
    // Prefer the row that contains our body text
    const row = page.locator("li").filter({ hasText: body }).first();
    await row.getByText("查看详情").click();
    await expect(page.getByTestId("push-detail")).toBeVisible();
    await expect(page.getByTestId("push-detail-media-list")).toBeVisible({ timeout: 20_000 });
    await assertNoHorizontalScroll(page);
    const detailUrl = page.url();

    await switchAccount(page, fixture.studentUsername, fixture.studentPassword);
    await page.goto(detailUrl.replace(/\/parent\/students\/[^/]+/, "/student"));
    // student detail path is /student/pushes/[pushId]
    const pushId = detailUrl.split("/pushes/")[1]?.split(/[?#]/)[0];
    expect(pushId).toBeTruthy();
    await page.goto(`/student/pushes/${pushId}`);
    await expect(page.getByTestId("student-push-detail")).toBeVisible();
    await expect(page.getByTestId("student-push-media-list")).toBeVisible({ timeout: 20_000 });

    await page.getByTestId("student-answer-image-input").setInputFiles(pngPath);
    await page.getByTestId("student-answer-submit").click();
    await expect(page.getByTestId("student-answer-current")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("student-answer-media-list")).toBeVisible({ timeout: 20_000 });
    await assertNoHorizontalScroll(page);

    // Reject bad file on parent create
    await switchAccount(page, fixture.parentEmail, fixture.parentPassword);
    await page.goto(`/parent/students/${fixture.studentId}/pushes`);
    await page.getByTestId("push-body-input").fill("should fail upload");
    await page.getByTestId("push-image-input").setInputFiles(badPath);
    await page.getByTestId("push-create-submit").click();
    await expect(page.getByTestId("push-error")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("push-image-status")).toContainText(/失败|重试/);

    // Delete original push → ordinary read unavailable
    await page.goto(`/parent/students/${fixture.studentId}/pushes/${pushId}`);
    await expect(page.getByTestId("push-detail")).toBeVisible();
    await page.getByTestId("push-delete").click();
    await page.getByTestId("push-delete").click();
    await expect(page).toHaveURL(new RegExp(`/parent/students/${fixture.studentId}/pushes$`));

    await page.goto(`/parent/students/${fixture.studentId}/pushes/${pushId}`);
    await expect(page.getByTestId("push-detail-error")).toBeVisible();
    await assertNoHorizontalScroll(page);

    void openLink;
    fs.unlinkSync(pngPath);
    fs.unlinkSync(badPath);
  });
});
