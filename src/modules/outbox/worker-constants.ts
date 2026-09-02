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
  ["reflection.created", new Set([1])],
  ["reflection.updated", new Set([1])],
  ["reflection.deleted", new Set([1])],
  ["private_access.granted", new Set([1])],
  ["private_access.revoked", new Set([1])],
  ["deletion.frozen", new Set([1])],
  ["deletion.confirmed", new Set([1])],
  ["deletion.admin_forced", new Set([1])],
  ["invitation.redeemed", new Set([1])],
  ["relationship.accepted", new Set([1])],
  ["relationship.requested", new Set([1])],
  ["plan.created", new Set([1])],
  ["training_session.completed", new Set([1])],
  ["training_session.terminated", new Set([1])],
  ["redemption_catalog.created", new Set([1])],
  ["redemption_catalog.updated", new Set([1])],
  ["point_redemption.requested", new Set([1])],
  ["point_redemption.cancelled", new Set([1])],
  ["point_redemption.approved", new Set([1])],
  ["point_redemption.rejected", new Set([1])],
  ["family_push.cancelled", new Set([1])],
]);

export function isSupportedNoopEvent(eventType: string, eventVersion: number): boolean {
  const versions = SUPPORTED_NOOP_EVENTS.get(eventType);
  return versions?.has(eventVersion) ?? false;
}
