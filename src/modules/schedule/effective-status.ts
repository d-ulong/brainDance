import { isPastCompletionWindow } from "@/modules/time-policy/completion-window";

export type ScheduleItemStatus =
  "pending" | "in_progress" | "completed" | "skipped" | "expired" | "cancelled";

/**
 * Read-only effective status for schedule items (GET paths).
 */
export function effectiveStatus(
  item: { status: string; familyDate: string; startedAt?: Date | null },
  now: Date,
): ScheduleItemStatus {
  if (item.status !== "pending") {
    return item.status as ScheduleItemStatus;
  }

  if (isPastCompletionWindow(item.familyDate, now)) {
    return "expired";
  }

  if (item.startedAt) {
    return "in_progress";
  }

  return "pending";
}
