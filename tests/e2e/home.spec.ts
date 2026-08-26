import { expect, test } from "@playwright/test";

test("home page renders", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "BrainDance" })).toBeVisible({ timeout: 15_000 });
});

test("health API returns ok", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { status: string };
  expect(body.status).toBe("ok");
});
