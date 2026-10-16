import path from "node:path";
import { defineConfig } from "vitest/config";

// Pure units must never migrate or reset the default developer database.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    fileParallelism: false,
    maxWorkers: 1,
    env: { SESSION_SECRET: "unit-test-session-secret-at-least-32-characters-long" },
  },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
});
