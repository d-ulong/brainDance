import type { Database } from "@/db";
import { processExportJob } from "@/modules/data-lifecycle/export-job.service";
import {
  createConfiguredFilesystemArtifactStore,
  type PrivateArtifactStore,
} from "@/modules/data-lifecycle/private-artifact-store";
import type { ClaimedOutboxEvent } from "@/modules/outbox/process-outbox-event.service";

export type M6OutboxHandler = (db: Database, event: ClaimedOutboxEvent) => Promise<void>;

let artifactStoreProvider: (() => PrivateArtifactStore) | null = null;

export function configureM6OutboxArtifactStore(provider: () => PrivateArtifactStore): void {
  artifactStoreProvider = provider;
}

function requireArtifactStore(): PrivateArtifactStore {
  if (!artifactStoreProvider) {
    // Shared default: configured persistent root (app/worker/tests must set env).
    const store = createConfiguredFilesystemArtifactStore();
    artifactStoreProvider = () => store;
  }
  return artifactStoreProvider();
}

const M6_EVENT_HANDLERS: ReadonlyMap<string, ReadonlyMap<number, M6OutboxHandler>> = new Map([
  ["export.requested", new Map<number, M6OutboxHandler>([[1, handleExportRequestedV1]])],
]);

export function getM6EventHandler(eventType: string, eventVersion: number): M6OutboxHandler | null {
  return M6_EVENT_HANDLERS.get(eventType)?.get(eventVersion) ?? null;
}

async function handleExportRequestedV1(db: Database, event: ClaimedOutboxEvent): Promise<void> {
  const jobId = event.payload.jobId;
  if (typeof jobId !== "string") {
    throw new Error("export.requested payload missing jobId");
  }

  await processExportJob(db, {
    jobId,
    artifactStore: requireArtifactStore(),
  });
}
