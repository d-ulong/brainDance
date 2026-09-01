#!/usr/bin/env tsx
/**
 * Independent lifecycle/outbox worker.
 * Processes export.requested (and other registered outbox handlers) without exposing
 * Worker capabilities to browser routes.
 *
 * Usage:
 *   BRAIN_DANCE_ARTIFACT_ROOT=<absolute-path> pnpm worker:lifecycle
 */

import { config } from "dotenv";
import { randomUUID } from "node:crypto";

import { getDb } from "../src/db";
import { configureM6OutboxArtifactStore } from "../src/modules/data-lifecycle/m6-outbox-handlers";
import { createConfiguredFilesystemArtifactStore } from "../src/modules/data-lifecycle/private-artifact-store";
import { processNextOutboxEvent } from "../src/modules/outbox/process-outbox-event.service";

config({ path: ".env.local" });
config({ path: ".env" });

const POLL_IDLE_MS = Number(process.env.LIFECYCLE_WORKER_IDLE_MS ?? "500");
const workerId = process.env.LIFECYCLE_WORKER_ID ?? `lifecycle-worker-${randomUUID()}`;

async function main() {
  process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";

  const artifactStore = createConfiguredFilesystemArtifactStore();
  configureM6OutboxArtifactStore(() => artifactStore);

  const db = getDb();
  console.log(
    JSON.stringify({
      component: "lifecycle_worker",
      workerId,
      status: "started",
      at: new Date().toISOString(),
    }),
  );

  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  while (!stopping) {
    const result = await processNextOutboxEvent(db, { workerId });
    if (!result.processed) {
      await new Promise((resolve) => setTimeout(resolve, POLL_IDLE_MS));
    }
  }

  console.log(
    JSON.stringify({
      component: "lifecycle_worker",
      workerId,
      status: "stopped",
      at: new Date().toISOString(),
    }),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
