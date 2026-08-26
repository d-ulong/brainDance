import { isPastCompletionWindow } from "@/modules/time-policy/completion-window";

export type ScheduleItemStatus = "pending" | "completed" | "skipped" | "expired" | "cancelled";

/**
 * Read-only effective status for schedule items (GET paths).
 */
export function effectiveStatus(
  item: { status: string; familyDate: string },
  now: Date,
): ScheduleItemStatus {
  if (item.status !== "pending") {
    return item.status as ScheduleItemStatus;
  }

  if (isPastCompletionWindow(item.familyDate, now)) {
    return "expired";
  }

  return "pending";
}
