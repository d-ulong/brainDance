import { expect, test } from "@playwright/test";

import { loadE2eFixture, loginViaUi } from "./ui-helpers";

async function chooseStudents(page: import("@playwright/test").Page, names: string[]) {
  await page.locator('[role="dialog"] details summary').click();
  for (const name of names) await page.getByLabel(name, { exact: true }).check();
}

test.describe("plan and push library forms", () => {
  test("plan save, multi-student binding/removal, and push draft/publish all issue real requests", async ({
    page,
  }) => {
    const fixture = loadE2eFixture();
    const runLabel = test.info().project.name;
    const planTitle = `E2E 多学生计划 ${runLabel}`;
    const pushBody = `E2E 多学生推送 ${runLabel}`;
    const draftBody = `E2E 草稿 ${runLabel}`;
    await loginViaUi(page, fixture.parentEmail, fixture.parentPassword);

    await page.goto("/parent/plans");
    await page.getByTestId("plan-library-create").click();
    await page.getByLabel("计划名称", { exact: true }).fill(planTitle);
    await page.getByLabel("名称", { exact: true }).fill("E2E 阅读");
    const savePlan = page.waitForResponse(
      (response) =>
        response.url().includes("/api/plan-library") && response.request().method() === "POST",
    );
    await page.getByTestId("plan-library-save").click();
    expect((await savePlan).ok()).toBeTruthy();
    await expect(page.getByText(planTitle, { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "添加学生" }).click();
    await chooseStudents(page, ["E2E Student", "E2E Second Student"]);
    await page.getByRole("button", { name: "绑定所选学生" }).click();
    await expect(page.getByText(/已绑定 2 名学生，生成 \d+ 项日程（实际日期 /)).toBeVisible();
    await expect(page.getByRole("button", { name: /E2E Student ×/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /E2E Second Student ×/ })).toBeVisible();

    const remove = page.waitForResponse(
      (response) =>
        response.url().includes("/bindings/") && response.request().method() === "DELETE",
    );
    await page.getByRole("button", { name: /E2E Student ×/ }).click();
    await page.getByRole("button", { name: "确认移除" }).click();
    expect((await remove).ok()).toBeTruthy();
    await expect(page.getByRole("button", { name: /E2E Student ×/ })).toHaveCount(0);

    await page.goto("/parent/pushes");
    await page.getByTestId("push-library-create").click();
    await page.getByLabel("内容", { exact: true }).fill(pushBody);
    await chooseStudents(page, ["E2E Student", "E2E Second Student"]);
    const publish = page.waitForResponse(
      (response) =>
        response.url().includes("/api/push-library") && response.request().method() === "PATCH",
    );
    await page.getByTestId("push-library-save").click();
    expect((await publish).ok()).toBeTruthy();
    await expect(page.getByText(pushBody, { exact: true })).toBeVisible();
    await expect(page.getByText("已投递 2 人")).toBeVisible();

    await page.getByTestId("push-library-create").click();
    await page.getByLabel("内容", { exact: true }).fill(draftBody);
    const saveDraft = page.waitForResponse(
      (response) =>
        response.url().includes("/api/push-library") && response.request().method() === "POST",
    );
    await page.getByTestId("push-library-save").click();
    expect((await saveDraft).ok()).toBeTruthy();
    await expect(page.getByText(draftBody, { exact: true })).toBeVisible();
  });
});
