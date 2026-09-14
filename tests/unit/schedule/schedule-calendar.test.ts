import { describe, expect, it } from "vitest";

import { moveCalendarDate, rangeForCalendarDate } from "@/components/schedule/schedule-calendar";

describe("schedule calendar ranges", () => {
  it("uses Sunday through Saturday for the week view", () => {
    expect(rangeForCalendarDate("2026-09-12", "week")).toEqual({
      from: "2026-09-06",
      through: "2026-09-12",
    });
  });

  it("loads a complete six-week grid for month view", () => {
    expect(rangeForCalendarDate("2026-09-12", "month")).toEqual({
      from: "2026-08-30",
      through: "2026-10-10",
    });
  });

  it("moves across month and year boundaries deterministically", () => {
    expect(moveCalendarDate("2026-12-12", "month", 1)).toBe("2027-01-12");
    expect(moveCalendarDate("2026-09-12", "week", -1)).toBe("2026-09-05");
  });
});
