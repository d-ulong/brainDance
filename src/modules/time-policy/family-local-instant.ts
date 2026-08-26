import { familyTimezone } from "@/modules/time-policy/to-family-date";

/**
 * Converts a family calendar date and local clock time to a UTC instant.
 * Time zone name comes from familyTimezone(); offset mapping lives here only.
 */
export function familyLocalInstant(familyDate: string, time: string): Date {
  const offset = offsetForFamilyTimezone(familyTimezone());
  return new Date(`${familyDate}T${time}${offset}`);
}

function offsetForFamilyTimezone(timeZone: string): string {
  if (timeZone !== familyTimezone()) {
    throw new Error(`Unsupported family timezone: ${timeZone}`);
  }

  return "+08:00";
}
