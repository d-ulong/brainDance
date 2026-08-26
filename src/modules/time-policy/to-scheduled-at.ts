import { familyTimezone } from "@/modules/time-policy/to-family-date";

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

  const offset = timezoneOffsetFor(familyTimezone());
  const iso = `${familyDate}T${hours}:${minutes}:${seconds}.000${offset}`;

  return new Date(iso);
}

function timezoneOffsetFor(timeZone: string): string {
  if (timeZone === "Asia/Shanghai") {
    return "+08:00";
  }

  throw new Error(`Unsupported family timezone: ${timeZone}`);
}
