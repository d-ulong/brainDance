import { addFamilyDays } from "@/modules/time-policy/add-family-days";

/**
 * Returns a closed interval of family dates from `from` through `through` (inclusive).
 */
export function familyDateRange(from: string, through: string): string[] {
  if (from > through) {
    return [];
  }

  const dates: string[] = [];
  let current = from;

  while (current <= through) {
    dates.push(current);
    if (current === through) {
      break;
    }
    current = addFamilyDays(current, 1);
  }

  return dates;
}
