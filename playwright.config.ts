import { config } from "dotenv";
import { defineConfig, devices } from "@playwright/test";

config({ path: ".env.local" });
config({ path: ".env" });

const e2ePort = process.env.PLAYWRIGHT_PORT ?? "3002";
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${e2ePort}`;
const sessionSecret =
  process.env.SESSION_SECRET ?? "test-session-secret-at-least-32-characters-long";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  timeout: 60_000,
  globalSetup: "./tests/e2e/global-setup.ts",
  reporter: "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(process.env.CI ? {} : { channel: "chrome" }),
      },
    },
    {
      name: "mobile-360",
      use: {
        ...devices["Desktop Chrome"],
        ...(process.env.CI ? {} : { channel: "chrome" }),
        viewport: { width: 360, height: 800 },
      },
    },
  ],
  webServer: {
    command: process.env.CI
      ? `pnpm build && pnpm exec next start -p ${e2ePort}`
      : `pnpm exec next dev -p ${e2ePort}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      ...process.env,
      SESSION_SECRET: sessionSecret,
    },
  },
});
