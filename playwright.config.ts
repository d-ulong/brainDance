import path from "node:path";

import { config } from "dotenv";
import { defineConfig, devices } from "@playwright/test";

config({ path: ".env.local" });
config({ path: ".env" });

const e2ePort = process.env.PLAYWRIGHT_PORT ?? "3003";
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${e2ePort}`;
const supervised = process.env.E2E_SUPERVISED === "true";

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
  ...(supervised
    ? {}
    : {
        webServer: {
          command: `node "${path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next")}" start -p ${e2ePort}`,
          url: baseURL,
          reuseExistingServer: false,
          timeout: 300_000,
          env: {
            ...(({ NODE_ENV: _nodeEnv, ...rest }) => rest)(process.env),
            SESSION_SECRET:
              process.env.SESSION_SECRET ?? "test-session-secret-at-least-32-characters-long",
            SESSION_COOKIE_SECURE: "false",
            EXPOSE_DEV_OTP: "true",
          },
        },
      }),
});
