import path from "node:path";
import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// Focused UI verification against an explicitly isolated database, no production build.
const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (url.pathname !== "/braindance_account_ui_test_20260909")
  throw new Error("Account UI checks require the isolated account test database");
export default defineConfig({
  ...base,
  testMatch: ["account-experience.spec.ts", "home.spec.ts"],
  webServer: {
    command: `node "${path.join(process.cwd(), "node_modules/next/dist/bin/next")}" dev -H 127.0.0.1 -p 3003`,
    url: "http://127.0.0.1:3003",
    reuseExistingServer: false,
    timeout: 120_000,
    env: { ...process.env, SESSION_COOKIE_SECURE: "false", EXPOSE_DEV_OTP: "true" },
  },
});
