/** M3 fixed operator constants — documented operator surface. */
export const OUTBOX_MAX_ATTEMPTS = 5;
export const OUTBOX_LEASE_DURATION_MS = 30_000;
export const OUTBOX_BASE_BACKOFF_MS = 1_000;

export function computeBackoffMs(attemptNumber: number): number {
  return OUTBOX_BASE_BACKOFF_MS * 2 ** Math.max(0, attemptNumber - 1);
}

/** Supported event type/version pairs for no-op delivery. */
export const SUPPORTED_NOOP_EVENTS: ReadonlyMap<string, ReadonlySet<number>> = new Map([
  ["schedule.completed", new Set([1])],
  ["point_rule.enabled", new Set([1])],
  ["relationship.ended", new Set([1])],
  ["plan.deactivated", new Set([1])],
  ["point_rule.deactivated", new Set([1])],
]);

export function isSupportedNoopEvent(eventType: string, eventVersion: number): boolean {
  const versions = SUPPORTED_NOOP_EVENTS.get(eventType);
  return versions?.has(eventVersion) ?? false;
}
