import { addFamilyDays } from "@/modules/time-policy/add-family-days";
import { familyTimezone } from "@/modules/time-policy/to-family-date";

/**
 * Returns the inclusive end of the completion window in UTC.
 * Window ends at familyDate + 1 family day 23:59:59.999 in the family timezone.
 */
export function completionWindowEnd(familyDate: string): Date {
  const lastFamilyDate = addFamilyDays(familyDate, 1);
  return familyLocalInstant(lastFamilyDate, "23:59:59.999");
}

/**
 * True when `now` is within the inclusive completion window for `familyDate`.
 */
export function isWithinCompletionWindow(familyDate: string, now: Date): boolean {
  const start = familyLocalInstant(familyDate, "00:00:00.000");
  const end = completionWindowEnd(familyDate);
  const timestamp = now.getTime();

  return timestamp >= start.getTime() && timestamp <= end.getTime();
}

/**
 * True when `now` is strictly after the completion window end.
 */
export function isPastCompletionWindow(familyDate: string, now: Date): boolean {
  return now.getTime() > completionWindowEnd(familyDate).getTime();
}

function familyLocalInstant(familyDate: string, time: string): Date {
  const offset = timezoneOffsetFor(familyTimezone());
  return new Date(`${familyDate}T${time}${offset}`);
}

function timezoneOffsetFor(timeZone: string): string {
  if (timeZone === "Asia/Shanghai") {
    return "+08:00";
  }

  throw new Error(`Unsupported family timezone: ${timeZone}`);
}
