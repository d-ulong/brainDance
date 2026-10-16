import path from "node:path";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: path.resolve(process.cwd(), "tests/e2e"),
  testMatch: "session-recovery.spec.ts",
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 15_000 },
  outputDir: path.resolve(process.cwd(), ".braindance-artifacts/review-browser"),
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:3004", channel: "chrome" },
  projects: [
    {name: "desktop", use: {viewport: {width: 1280, height: 900}}},
    {name: "mobile", use: {viewport: {width: 360, height: 800}}},
  ],
});
