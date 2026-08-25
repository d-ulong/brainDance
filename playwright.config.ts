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
  testIgnore: ["**/m1-evidence-capture.spec.ts"],
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
    // Build in production mode, then serve over HTTP with non-Secure session cookies for E2E.
    command: "pnpm exec tsx scripts/e2e-web-server.mts",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 300_000,
    env: {
      ...process.env,
      SESSION_SECRET: sessionSecret,
      SESSION_COOKIE_SECURE: "false",
      EXPOSE_DEV_OTP: "true",
    },
  },
});
