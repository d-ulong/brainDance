import path from "node:path";

import { config as loadEnv } from "dotenv";
import { defineConfig } from "vitest/config";

loadEnv({ path: ".env.local", override: true });
loadEnv({ override: true });

const artifactRoot = path.resolve(process.cwd(), ".braindance-artifacts", "vitest");
const mediaRoot = path.resolve(process.cwd(), ".braindance-media", "vitest");
process.env.BRAIN_DANCE_ARTIFACT_ROOT ??= artifactRoot;
process.env.BRAIN_DANCE_MEDIA_ROOT ??= mediaRoot;
process.env.BRAIN_DANCE_MEDIA_SCANNER ??= "test-clean";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
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
    env: {
      BRAIN_DANCE_ARTIFACT_ROOT: process.env.BRAIN_DANCE_ARTIFACT_ROOT ?? artifactRoot,
      BRAIN_DANCE_MEDIA_ROOT: process.env.BRAIN_DANCE_MEDIA_ROOT ?? mediaRoot,
      BRAIN_DANCE_MEDIA_SCANNER: process.env.BRAIN_DANCE_MEDIA_SCANNER ?? "test-clean",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
