import type { Database } from "@/db";
import { rebuildProjectionForStudent } from "@/modules/projection/rebuild-projection.service";
import type { ClaimedOutboxEvent } from "@/modules/outbox/process-outbox-event.service";

export type M3OutboxHandler = (db: Database, event: ClaimedOutboxEvent) => Promise<void>;

const M3_EVENT_HANDLERS: ReadonlyMap<string, ReadonlyMap<number, M3OutboxHandler>> = new Map([
  ["fact.submitted", new Map<number, M3OutboxHandler>([[1, handleFactSubmittedV1]])],
  ["fact.confirmed", new Map<number, M3OutboxHandler>([[1, handleFactConfirmedV1]])],
  ["fact.corrected", new Map<number, M3OutboxHandler>([[1, handleFactCorrectedV1]])],
  ["points.settled", new Map<number, M3OutboxHandler>([[1, handlePointsSettledV1]])],
]);

export function getM3EventHandler(eventType: string, eventVersion: number): M3OutboxHandler | null {
  return M3_EVENT_HANDLERS.get(eventType)?.get(eventVersion) ?? null;
}

async function handleFactSubmittedV1(): Promise<void> {
  // Safe delivery: settlement occurs on confirm; no projection side effects here.
}

async function handleFactConfirmedV1(db: Database, event: ClaimedOutboxEvent): Promise<void> {
  await reconcileStudentProjectionFromPayload(db, event.payload);
}

async function handleFactCorrectedV1(db: Database, event: ClaimedOutboxEvent): Promise<void> {
  await reconcileStudentProjectionFromPayload(db, event.payload);
}

async function handlePointsSettledV1(db: Database, event: ClaimedOutboxEvent): Promise<void> {
  await reconcileStudentProjectionFromPayload(db, event.payload);
}

async function reconcileStudentProjectionFromPayload(
  db: Database,
  payload: Record<string, unknown>,
): Promise<void> {
  const studentId = payload.studentId;
  if (typeof studentId !== "string") {
    throw new Error("M3 handler payload missing studentId");
  }

  await db.transaction(async (tx) => {
    await rebuildProjectionForStudent(tx, studentId);
  });
}
