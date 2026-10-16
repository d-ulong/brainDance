import { archiveAdultStudent, processDueSchedule } from "@/modules/data-lifecycle/due-work.service";
import {
  getDeletionRequest,
  processDeletionWorker,
} from "@/modules/data-lifecycle/deletion-request.service";
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
  [
    "lifecycle.schedule_due",
    new Map<number, M6OutboxHandler>([
      [
        1,
        async (db, event) => {
          const { studentId, scheduleItemId } = event.payload;
          if (typeof studentId !== "string" || typeof scheduleItemId !== "string")
            throw new Error("Invalid schedule due payload");
          await processDueSchedule(db, studentId, scheduleItemId);
        },
      ],
    ]),
  ],
  [
    "lifecycle.deletion_due",
    new Map<number, M6OutboxHandler>([
      [
        1,
        async (db, event) => {
          if (typeof event.payload.requestId !== "string")
            throw new Error("Invalid deletion due payload");
          const request = await getDeletionRequest(db, event.payload.requestId);
          if (!request || request.status === "cancelled") return;
          const result = await processDeletionWorker(db, {
            requestId: event.payload.requestId,
            artifactStore: requireArtifactStore(),
          });
          if (!result.executed && result.status !== "executed" && result.status !== "cancelled")
            throw new Error("Deletion due condition changed");
        },
      ],
    ]),
  ],
  [
    "lifecycle.age_due",
    new Map<number, M6OutboxHandler>([
      [
        1,
        async (db, event) => {
          if (typeof event.payload.studentId !== "string")
            throw new Error("Invalid age due payload");
          await archiveAdultStudent(db, event.payload.studentId);
        },
      ],
    ]),
  ],
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
