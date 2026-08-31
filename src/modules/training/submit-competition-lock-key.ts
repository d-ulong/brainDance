/** Global advisory lock coordinating full projection rebuild with submit writes. */
export const TRAINING_PROFILE_PROJECTION_FULL_REBUILD_LOCK_KEY =
  "training:profile-projection:full-rebuild";

export function buildFullRebuildProjectionLockKey(): string {
  return TRAINING_PROFILE_PROJECTION_FULL_REBUILD_LOCK_KEY;
}

/**
 * Per-day effective-session competition lock.
 * Acquire order when both are needed: full rebuild lock, then submit competition lock.
 */
export function buildSubmitCompetitionLockKey(
  studentId: string,
  trainingKey: string,
  familyDate: string,
): string {
  return `${studentId}:${trainingKey}:${familyDate}`;
}
