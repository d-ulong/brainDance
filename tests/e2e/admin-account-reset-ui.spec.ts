import { expect, test } from "@playwright/test";

test.setTimeout(60_000);

// All identities and credentials in this file are synthetic HTTP-response fixtures.
// These cases never reset real database accounts.
const admin = {
  userId: "00000000-0000-4000-8000-000000000001",
  role: "admin",
  account: "admin@example.test",
  displayName: "账号管理测试管理员",
  contactVerified: true,
  mustChangePassword: false,
};
const parent = {
  userId: "00000000-0000-4000-8000-000000000002",
  account: "parent@example.test",
  displayName: "待重置家长",
  role: "parent",
  status: "active",
  mustChangePassword: false,
  authorizationEpoch: 7,
};
const temporaryPassword = "TestTemp4X";

for (const theme of ["space", "candy"]) {
  test(`${theme}: account search, confirmation, once-only password and responsive layout`, async ({
    page,
  }) => {
    await page.addInitScript((value) => localStorage.setItem("braindance-theme", value), theme);
    await page.addInitScript(() => {
      let copied = "";
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (value: string) => {
            copied = value;
          },
          readText: async () => copied,
        },
      });
    });
    await page.route("**/api/auth/session", (route) => route.fulfill({ json: admin }));
    const queries: URLSearchParams[] = [];
    await page.route("**/api/admin/accounts?*", (route) => {
      queries.push(new URL(route.request().url()).searchParams);
      return route.fulfill({
        json: {
          items: [{ ...admin, status: "active", authorizationEpoch: 1 }, parent],
          total: 2,
          page: 1,
          pageSize: 20,
        },
      });
    });
    let commands = 0;
    await page.route("**/api/admin/accounts/*/reset-password", (route) => {
      commands += 1;
      expect(route.request().postDataJSON()).toMatchObject({ expectedAuthorizationEpoch: 7 });
      return route.fulfill({
        json: {
          userId: parent.userId,
          authorizationEpoch: 8,
          mustChangePassword: true,
          temporaryPassword,
          idempotentReplay: false,
        },
      });
    });
    await page.goto("/admin/accounts");
    const selfRow = page.getByTestId(`account-row-${admin.userId}`);
    await expect(selfRow.getByRole("link", { name: "修改本人密码" })).toBeVisible();
    await expect(selfRow.getByRole("button", { name: "重置密码" })).toHaveCount(0);
    await page.getByTestId("accounts-search").fill(parent.account);
    await page.getByTestId("accounts-role").selectOption("parent");
    await page.getByRole("button", { name: "查询", exact: true }).click();
    await expect
      .poll(() =>
        queries.some(
          (query) => query.get("search") === parent.account && query.get("role") === "parent",
        ),
      )
      .toBe(true);
    await page.getByTestId(`reset-password-${parent.userId}`).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(parent.account);
    await expect(dialog).toContainText("旧密码和现有登录会话立即失效");
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    expect(commands).toBe(0);
    await page.getByTestId(`reset-password-${parent.userId}`).click();
    await page.getByTestId("confirm-password-reset").click();
    await expect(page.getByTestId("temporary-password")).toHaveText(temporaryPassword);
    await expect(dialog.getByRole("button", { name: "复制临时密码" })).toBeVisible();
    await dialog.getByRole("button", { name: "复制临时密码" }).click();
    await expect(dialog.getByRole("status")).toHaveText("已复制临时密码");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(temporaryPassword);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const dimensions = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
    }));
    expect(dimensions.content).toBeLessThanOrEqual(dimensions.width + 1);
    const colors = await page.getByTestId("temporary-password").evaluate((element) => {
      const style = getComputedStyle(element);
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const context = canvas.getContext("2d")!;
      const luminance = (color: string) => {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        const rgb = context.getImageData(0, 0, 1, 1).data;
        return [0.2126, 0.7152, 0.0722].reduce((sum, weight, index) => {
          const value = rgb[index]! / 255;
          return (
            sum + weight * (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
          );
        }, 0);
      };
      const foreground = luminance(style.color);
      const background = luminance(style.backgroundColor);
      return {
        contrast:
          (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05),
        fontSize: parseFloat(style.fontSize),
      };
    });
    expect(colors.contrast).toBeGreaterThanOrEqual(4.5);
    expect(colors.fontSize).toBeGreaterThanOrEqual(18);
    expect(
      await page.evaluate(
        () => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }),
      ),
    ).not.toContain(temporaryPassword);
    await dialog.getByRole("button", { name: "已保存，关闭" }).click();
    await expect(page.getByTestId("temporary-password")).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId("accounts-list")).toBeVisible();
    await expect(page.getByTestId("temporary-password")).toHaveCount(0);
    expect(commands).toBe(1);
  });
}

test("lost reset response retries the same command without redisplaying plaintext; stale row refreshes", async ({
  page,
}) => {
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: admin }));
  await page.route("**/api/admin/accounts?*", (route) =>
    route.fulfill({ json: { items: [parent], total: 1, page: 1, pageSize: 20 } }),
  );
  const keys: string[] = [];
  let conflict = false;
  await page.route("**/api/admin/accounts/*/reset-password", (route) => {
    keys.push(route.request().postDataJSON().idempotencyKey);
    if (conflict)
      return route.fulfill({
        status: 409,
        json: { error: { code: "STATE_CONFLICT", message: "版本过期" } },
      });
    if (keys.length === 1) return route.abort("failed");
    return route.fulfill({
      json: {
        userId: parent.userId,
        authorizationEpoch: 8,
        mustChangePassword: true,
        idempotentReplay: true,
      },
    });
  });
  await page.goto("/admin/accounts");
  await page.getByTestId(`reset-password-${parent.userId}`).click();
  await page.getByTestId("confirm-password-reset").click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("未能确认重置结果");
  await page.getByRole("button", { name: "重试本次重置" }).click();
  expect(keys[0]).toBe(keys[1]);
  await expect(page.getByRole("dialog")).toContainText("临时密码不会重复显示");
  await expect(page.getByTestId("temporary-password")).toHaveCount(0);
  await page.getByRole("button", { name: "已保存，关闭" }).click();
  conflict = true;
  await page.getByTestId(`reset-password-${parent.userId}`).click();
  await page.getByTestId("confirm-password-reset").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("alert").filter({ hasText: "账号已发生变化" })).toBeVisible();
  await page.getByRole("button", { name: "刷新列表" }).click();
  await expect(page.getByTestId("accounts-list")).toBeVisible();
});

for (const role of ["student", "parent", "admin"] as const) {
  test(`${role}: forced password takes precedence over business and contact verification`, async ({
    page,
  }) => {
    let changed = false;
    await page.route("**/api/auth/session", (route) =>
      route.fulfill({
        json: { ...admin, role, contactVerified: role !== "parent", mustChangePassword: !changed },
      }),
    );
    await page.route("**/api/auth/change-password", (route) => {
      const command = route.request().postDataJSON();
      expect(command.currentPassword).toBe(temporaryPassword);
      expect(command.newPassword).toBe("OwnSecret7A");
      changed = true;
      return route.fulfill({
        json: { userId: admin.userId, mustChangePassword: false, idempotentReplay: false },
      });
    });
    await page.goto("/");
    await expect(page).toHaveURL(/\/change-password$/);
    await expect(page.getByRole("heading", { name: "设置自己的新密码" })).toBeVisible();
    await expect(page.getByTestId("top-tabs")).toHaveCount(0);
    await page.getByTestId("current-password").fill(temporaryPassword);
    await page.getByTestId("new-password").fill(temporaryPassword);
    await page.getByTestId("confirm-password").fill(temporaryPassword);
    await page.getByTestId("change-password-submit").click();
    await expect(page.getByTestId("change-password-error")).toHaveText("新密码不能与当前密码相同");
    await page.getByTestId("new-password").fill("OwnSecret7A");
    await page.getByTestId("confirm-password").fill("OwnSecret7A");
    await page.getByTestId("change-password-submit").click();
    await expect(page).toHaveURL(role === "parent" ? /\/verify-contact$/ : /\/$/);
    expect(changed).toBe(true);
  });
}

test("administrator can change own password through account navigation", async ({ page }) => {
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: admin }));
  await page.route("**/api/auth/change-password", (route) =>
    route.fulfill({
      json: { userId: admin.userId, mustChangePassword: false, idempotentReplay: false },
    }),
  );
  await page.goto("/account");
  await page.getByRole("link", { name: "修改本人密码", exact: false }).click();
  await expect(page).toHaveURL(/\/change-password$/);
  await page.getByTestId("current-password").fill(temporaryPassword);
  await page.getByTestId("new-password").fill("OwnSecret7A");
  await page.getByTestId("confirm-password").fill("OwnSecret7A");
  await page.getByTestId("change-password-submit").click();
  await expect(page.getByTestId("change-password-success")).toBeVisible();
  await expect(page.getByTestId("top-tab-admin-accounts")).toBeVisible();
});
