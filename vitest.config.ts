import path from "node:path";

import { config as loadEnv } from "dotenv";
import { defineConfig } from "vitest/config";

loadEnv({ path: ".env.local", override: true });
loadEnv({ override: true });

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "tests/unit/**/*.test.ts",
      "tests/unit/**/*.test.tsx",
      "tests/integration/**/*.test.ts",
    ],
    globalSetup: ["tests/global-setup.ts"],
    setupFiles: ["tests/setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Integration tests share one Postgres instance and TRUNCATE between cases.
    // A single worker avoids cross-file TRUNCATE races on the shared database.
    fileParallelism: false,
    maxWorkers: 1,
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  esbuild: {
    jsx: "automatic",
  },
});
