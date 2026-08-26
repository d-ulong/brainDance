import { addFamilyDays } from "@/modules/time-policy/add-family-days";
import { toFamilyDate } from "@/modules/time-policy/to-family-date";

/**
 * Returns the inclusive horizon upper bound for schedule generation.
 */
export function horizonThrough(plan: { end_date?: string | null }, now: Date): string {
  const cap = addFamilyDays(toFamilyDate(now), 30);

  if (plan.end_date == null) {
    return cap;
  }

  return plan.end_date < cap ? plan.end_date : cap;
}
