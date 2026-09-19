import type { ScheduleItemDto } from "@/lib/client/m2-api";

const ACTIVE_STATUSES = new Set(["pending", "in_progress"]);

export function sortScheduleForDay(items: ScheduleItemDto[]): ScheduleItemDto[] {
  return [...items].sort((left, right) => left.scheduledAt.localeCompare(right.scheduledAt));
}

/** Next actionable item: in_progress first, then earliest pending by scheduled time. */
export function pickNextScheduleItem(items: ScheduleItemDto[]): ScheduleItemDto | null {
  const sorted = sortScheduleForDay(items);
  const inProgress = sorted.find((item) => item.effectiveStatus === "in_progress");
  if (inProgress) return inProgress;
  return sorted.find((item) => item.effectiveStatus === "pending") ?? null;
}

export function countActionableToday(items: ScheduleItemDto[]): number {
  return items.filter((item) => ACTIVE_STATUSES.has(item.effectiveStatus)).length;
}

export function formatScheduleTimeRange(item: ScheduleItemDto): string {
  const start = new Date(item.scheduledAt);
  const startLabel = start.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  });
  if (item.durationMinutes && item.durationMinutes > 0) {
    const end = new Date(start.getTime() + item.durationMinutes * 60_000);
    const endLabel = end.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Asia/Shanghai",
    });
    return `${startLabel} – ${endLabel}`;
  }
  return startLabel;
}
