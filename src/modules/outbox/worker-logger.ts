export type WorkerLogEntry = {
  eventId: string;
  eventType: string;
  eventVersion: number;
  attemptNumber: number;
  errorCategory?: string;
  aggregateType?: string;
  aggregateId?: string;
  outcome: "claimed" | "success" | "failure" | "dead" | "lease_mismatch";
};

export function logWorkerEvent(entry: WorkerLogEntry): void {
  const payload: Record<string, string | number> = {
    level: entry.outcome === "failure" || entry.outcome === "dead" ? "error" : "info",
    component: "outbox_worker",
    eventId: entry.eventId,
    eventType: entry.eventType,
    eventVersion: entry.eventVersion,
    attemptNumber: entry.attemptNumber,
    outcome: entry.outcome,
  };

  if (entry.errorCategory) {
    payload.errorCategory = entry.errorCategory;
  }
  if (entry.aggregateType) {
    payload.aggregateType = entry.aggregateType;
  }
  if (entry.aggregateId) {
    payload.aggregateId = entry.aggregateId;
  }

  console.log(JSON.stringify(payload));
}
