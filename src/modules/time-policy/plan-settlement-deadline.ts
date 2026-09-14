import { addFamilyDays } from "@/modules/time-policy/add-family-days";
import { familyLocalInstant } from "@/modules/time-policy/family-local-instant";

/** Plan-item completion and automatic non-completion are finalized at 18:00 next family day. */
export function planSettlementDeadline(familyDate: string): Date {
  return familyLocalInstant(addFamilyDays(familyDate, 1), "18:00:00.000");
}

export function isPastPlanSettlementDeadline(familyDate: string, now: Date): boolean {
  return now.getTime() > planSettlementDeadline(familyDate).getTime();
}
