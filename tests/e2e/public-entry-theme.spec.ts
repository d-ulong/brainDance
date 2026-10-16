import { expect, test } from "@playwright/test";

for (const theme of ["space", "candy"] as const) {
  test(`public entry cards stay readable in ${theme}`, async ({ page }, testInfo) => {
    await page.addInitScript((value) => localStorage.setItem("braindance-theme", value), theme);
    await page.goto("/");
    const cards = page.locator(".bd-action-card");
    await expect(cards).toHaveCount(2);
    await expect(cards.first()).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const metrics = await cards.evaluateAll((elements) => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const context = canvas.getContext("2d")!;
      const luminance = (color: string) => {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        const rgb = context.getImageData(0, 0, 1, 1).data;
        return [0.2126, 0.7152, 0.0722].reduce((sum, weight, i) => {
          const v = rgb[i]! / 255;
          return sum + weight * (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
        }, 0);
      };
      return elements.map((card) => {
        const background = luminance(getComputedStyle(card).backgroundColor);
        const children = [
          card.querySelector("strong")!,
          card.querySelector(":scope > span:last-child")!,
        ];
        return children.map((element) => {
          const style = getComputedStyle(element);
          const foreground = luminance(style.color);
          return {
            contrast:
              (Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05),
            fontSize: parseFloat(style.fontSize),
          };
        });
      });
    });
    for (const [title, description] of metrics) {
      expect(title!.contrast).toBeGreaterThanOrEqual(4.5);
      expect(description!.contrast).toBeGreaterThanOrEqual(4.5);
      expect(title!.fontSize).toBeGreaterThanOrEqual(18);
      expect(description!.fontSize).toBeGreaterThanOrEqual(14);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: testInfo.outputPath("public-home.png"), fullPage: true });
    await cards.first().focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByTestId("login-identifier")).toBeVisible();
    await page.goto("/");
    await page.locator('.bd-action-card[href="/register"]').click();
    await expect(page).toHaveURL(/\/register$/);
    console.log(JSON.stringify({ theme, width: page.viewportSize()!.width, metrics }));
  });
}
