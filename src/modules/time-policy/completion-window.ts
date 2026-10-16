import { addFamilyDays } from "@/modules/time-policy/add-family-days";
import { familyLocalInstant } from "@/modules/time-policy/family-local-instant";

/**
 * Exclusive ordinary completion cutoff: next family day at 22:00.
 */
export function completionWindowEnd(familyDate: string): Date {
  const lastFamilyDate = addFamilyDays(familyDate, 1);
  return familyLocalInstant(lastFamilyDate, "22:00:00.000");
}

/**
 * True from task-day midnight up to, but excluding, the next-day cutoff.
 */
export function isWithinCompletionWindow(familyDate: string, now: Date): boolean {
  const start = familyLocalInstant(familyDate, "00:00:00.000");
  const end = completionWindowEnd(familyDate);
  const timestamp = now.getTime();

  return timestamp >= start.getTime() && timestamp < end.getTime();
}

/**
 * True when the ordinary completion window has closed, including the boundary.
 */
export function isPastCompletionWindow(familyDate: string, now: Date): boolean {
  return now.getTime() >= completionWindowEnd(familyDate).getTime();
}
