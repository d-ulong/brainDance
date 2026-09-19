import { describe, expect, it } from "vitest";

import type { ScheduleItemDto } from "@/lib/client/m2-api";
import { pickNextScheduleItem, sortScheduleForDay } from "@/lib/schedule/home-schedule";

function item(
  partial: Partial<ScheduleItemDto> & Pick<ScheduleItemDto, "id" | "scheduledAt">,
): ScheduleItemDto {
  return {
    planId: "p",
    planVersionId: "v",
    studentId: "s",
    ownerId: "o",
    familyDate: "2026-09-19",
    slotKey: "k",
    status: "pending",
    source: "plan",
    occurrenceKey: partial.id,
    effectiveStatus: "pending",
    title: partial.title ?? partial.id,
    planTitle: "plan",
    priority: 0,
    startedAt: null,
    ...partial,
  };
}

describe("home schedule helpers", () => {
  it("sorts by scheduled time", () => {
    const sorted = sortScheduleForDay([
      item({ id: "b", scheduledAt: "2026-09-19T18:00:00+08:00" }),
      item({ id: "a", scheduledAt: "2026-09-19T08:00:00+08:00" }),
    ]);
    expect(sorted.map((row) => row.id)).toEqual(["a", "b"]);
  });

  it("prefers in_progress over earlier pending", () => {
    const next = pickNextScheduleItem([
      item({ id: "early", scheduledAt: "2026-09-19T08:00:00+08:00", effectiveStatus: "pending" }),
      item({
        id: "active",
        scheduledAt: "2026-09-19T20:00:00+08:00",
        effectiveStatus: "in_progress",
      }),
    ]);
    expect(next?.id).toBe("active");
  });

  it("returns earliest pending when none in progress", () => {
    const next = pickNextScheduleItem([
      item({ id: "late", scheduledAt: "2026-09-19T20:00:00+08:00", effectiveStatus: "pending" }),
      item({ id: "soon", scheduledAt: "2026-09-19T17:00:00+08:00", effectiveStatus: "pending" }),
    ]);
    expect(next?.id).toBe("soon");
  });
});
