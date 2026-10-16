import {
  completionWindowEnd,
  isPastCompletionWindow,
} from "@/modules/time-policy/completion-window";

/** Uses the same exclusive cutoff as ordinary completion. */
export function planSettlementDeadline(familyDate: string): Date {
  return completionWindowEnd(familyDate);
}

export function isPastPlanSettlementDeadline(familyDate: string, now: Date): boolean {
  return isPastCompletionWindow(familyDate, now);
}
