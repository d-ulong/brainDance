import path from "node:path";

import { config } from "dotenv";
import { defineConfig, devices } from "@playwright/test";

config({ path: ".env.local" });
config({ path: ".env" });

const e2ePort = process.env.PLAYWRIGHT_PORT ?? "3002";
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${e2ePort}`;
const sessionSecret =
  process.env.SESSION_SECRET ?? "test-session-secret-at-least-32-characters-long";
const nextBin = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");

const { NODE_ENV: _nodeEnv, ...processEnv } = process.env;
const webServerEnv = {
  ...processEnv,
  SESSION_SECRET: sessionSecret,
  SESSION_COOKIE_SECURE: "false",
  EXPOSE_DEV_OTP: "true",
} satisfies Record<string, string | undefined>;

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
    // Spawn next directly so Playwright owns the process tree in non-interactive/CI runs.
    // Build runs in globalSetup; do not wrap with tsx/pnpm/shell intermediaries.
    command: `node "${nextBin}" start -p ${e2ePort}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 300_000,
    env: webServerEnv,
  },
});
