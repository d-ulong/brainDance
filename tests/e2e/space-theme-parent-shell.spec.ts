import { expect, test, type Locator, type Page } from "@playwright/test";

import { fillField, loadE2eFixture } from "./ui-helpers";

function channel(value: string) {
  return Number(value.trim());
}

function relativeLuminance(rgb: string) {
  const match = rgb.match(/rgba?\(([^)]+)\)/);
  if (!match) throw new Error(`Unsupported color: ${rgb}`);
  const values = match[1].split(",").slice(0, 3).map(channel);
  const linear = values.map((value) => {
    const normalized = value / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

async function expectReadableContrast(locator: Locator) {
  const colors = await locator.evaluate((element) => {
    const foreground = getComputedStyle(element).color;
    let current: Element | null = element;
    let background = "rgba(0, 0, 0, 0)";
    while (current) {
      const candidate = getComputedStyle(current).backgroundColor;
      if (candidate !== "rgba(0, 0, 0, 0)" && candidate !== "transparent") {
        background = candidate;
        break;
      }
      current = current.parentElement;
    }
    return { foreground, background };
  });
  const lighter = Math.max(
    relativeLuminance(colors.foreground),
    relativeLuminance(colors.background),
  );
  const darker = Math.min(
    relativeLuminance(colors.foreground),
    relativeLuminance(colors.background),
  );
  expect((lighter + 0.05) / (darker + 0.05)).toBeGreaterThanOrEqual(4.5);
}

async function loginAsParentInSpaceTheme(page: Page) {
  const fixture = loadE2eFixture();
  await page.goto("/login");
  await page.evaluate(() => localStorage.setItem("braindance-theme", "space"));
  await page.reload();
  await fillField(page, "login-identifier", fixture.parentEmail);
  await fillField(page, "login-password", fixture.parentPassword);
  await page.getByTestId("login-password").press("Enter");
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  await expect(page.locator("html")).toHaveAttribute("data-theme", "space");
}

test("space theme keeps parent navigation and explanatory text readable", async ({ page }) => {
  await loginAsParentInSpaceTheme(page);
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto("/parent/plans");
  const topTabs = page.getByTestId("top-tabs");
  await expect(topTabs).toBeVisible();
  await expect(topTabs).toHaveCSS("flex-direction", "row");

  await page.goto("/parent/schedule");
  const personalScheduleNotice = page.getByText(
    "这是你本人的计划日程：开始/完成会按规则结算积分，仅用于个人记录，不进入学生兑换。",
  );
  await expect(personalScheduleNotice).toBeVisible();
  await expectReadableContrast(personalScheduleNotice);

  await page.goto("/parent/goals");
  await page.getByRole("button", { name: "新增目标" }).click();
  const studentSelect = page.locator(".bd-student-multi-select details");
  await expect(studentSelect).toBeVisible();
  await studentSelect.locator("summary").click();
  const firstStudent = studentSelect.locator("label span").first();
  await expect(firstStudent).toBeVisible();
  await expectReadableContrast(firstStudent);
  await expect(studentSelect).toHaveCSS("background-color", "rgb(25, 50, 72)");
});
