import { addFamilyDays } from "@/modules/time-policy/add-family-days";
import { toFamilyDate } from "@/modules/time-policy/to-family-date";

/**
 * Returns the family calendar date immediately after the instant's family date.
 */
export function nextFamilyDate(utc: Date): string {
  return addFamilyDays(toFamilyDate(utc), 1);
}
