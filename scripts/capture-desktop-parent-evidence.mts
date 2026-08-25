import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { chromium } from "@playwright/test";

type Fixture = {
  parentEmail: string;
  parentPassword: string;
  studentId: string;
};

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3002";
const fixture = JSON.parse(
  readFileSync(path.join(process.cwd(), "tests/e2e/.fixture.json"), "utf8"),
) as Fixture;
const outDir = path.join(
  process.cwd(),
  ".trellis/tasks/08-25-m1-verification-remediation/research/screenshots/desktop",
);
mkdirSync(outDir, { recursive: true });

async function fillField(
  page: import("playwright").Page,
  testId: string,
  value: string,
) {
  const input = page.getByTestId(testId);
  await input.click();
  await input.fill("");
  await input.pressSequentially(value, { delay: 15 });
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

await page.goto(`${baseURL}/login`, { waitUntil: "networkidle" });
await fillField(page, "login-identifier", fixture.parentEmail);
await fillField(page, "login-password", fixture.parentPassword);
await page.getByRole("textbox", { name: "密码" }).press("Enter");
await page.waitForURL((url) => !url.pathname.startsWith("/login"));

await page.goto(`${baseURL}/parent/students/${fixture.studentId}/training`, {
  waitUntil: "networkidle",
});
await page.getByTestId("parent-metric-median_reaction_ms").waitFor({ timeout: 15_000 });
await page.screenshot({
  path: path.join(outDir, "04-parent-training-summary.png"),
  fullPage: true,
});

await browser.close();
console.log("Saved desktop/04-parent-training-summary.png");
