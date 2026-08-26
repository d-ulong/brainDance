const LOCAL_TIME_PATTERN = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * Normalizes a local time value for occurrence_key (HH:MM).
 */
export function formatLocalTimeForKey(localTime: string): string {
  const match = LOCAL_TIME_PATTERN.exec(localTime);
  if (!match) {
    throw new Error(`Invalid local time for occurrence key: ${localTime}`);
  }

  return `${match[1]}:${match[2]}`;
}

/**
 * Builds the frozen occurrence_key format:
 * `{plan_id}:{plan_version_id}:{family_date}:daily:{localTime}`
 */
export function buildOccurrenceKey(input: {
  planId: string;
  planVersionId: string;
  familyDate: string;
  localTime: string;
}): string {
  const localTime = formatLocalTimeForKey(input.localTime);
  return `${input.planId}:${input.planVersionId}:${input.familyDate}:daily:${localTime}`;
}
