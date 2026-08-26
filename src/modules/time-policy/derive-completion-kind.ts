import { addFamilyDays } from "@/modules/time-policy/add-family-days";
import { toFamilyDate } from "@/modules/time-policy/to-family-date";

export type CompletionKind = "on_time" | "late";

/**
 * Derives completion kind from the occurred instant and planned family date.
 * Callers must validate the completion window before invoking this function.
 */
export function deriveCompletionKind(occurredAt: Date, familyDate: string): CompletionKind {
  const occurredFamilyDate = toFamilyDate(occurredAt);

  if (occurredFamilyDate === familyDate) {
    return "on_time";
  }

  if (occurredFamilyDate === addFamilyDays(familyDate, 1)) {
    return "late";
  }

  throw new Error(
    `Cannot derive completion kind for occurred family date ${occurredFamilyDate} and item family date ${familyDate}`,
  );
}
