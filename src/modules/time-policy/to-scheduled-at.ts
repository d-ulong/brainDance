import { familyLocalInstant } from "@/modules/time-policy/family-local-instant";

const LOCAL_TIME_PATTERN = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * Converts a family calendar date and local clock time in the family timezone to a UTC instant.
 */
export function toScheduledAt(familyDate: string, localTime: string): Date {
  const match = LOCAL_TIME_PATTERN.exec(localTime);
  if (!match) {
    throw new Error(`Invalid local time: ${localTime}`);
  }

  const hours = match[1];
  const minutes = match[2];
  const seconds = match[3] ?? "00";

  return familyLocalInstant(familyDate, `${hours}:${minutes}:${seconds}.000`);
}
