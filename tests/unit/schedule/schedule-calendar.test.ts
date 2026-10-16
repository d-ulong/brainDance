import { describe, expect, it } from "vitest";

import {
  moveCalendarDate,
  rangeForCalendarDate,
  rangeForCalendarSummary,
} from "@/components/schedule/schedule-calendar";

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

  it("summarizes only the selected calendar month while loading the surrounding grid", () => {
    expect(rangeForCalendarSummary("2026-09-12", "month")).toEqual({
      from: "2026-09-01",
      through: "2026-09-30",
    });
    expect(rangeForCalendarSummary("2028-02-29", "month")).toEqual({
      from: "2028-02-01",
      through: "2028-02-29",
    });
    expect(rangeForCalendarSummary("2026-09-12", "week")).toEqual(
      rangeForCalendarDate("2026-09-12", "week"),
    );
  });

  it("moves across month and year boundaries deterministically", () => {
    expect(moveCalendarDate("2026-12-12", "month", 1)).toBe("2027-01-12");
    expect(moveCalendarDate("2026-09-12", "week", -1)).toBe("2026-09-05");
  });

  it("clamps month-end navigation to the destination month", () => {
    expect(moveCalendarDate("2026-01-31", "month", 1)).toBe("2026-02-28");
    expect(moveCalendarDate("2026-03-31", "month", -1)).toBe("2026-02-28");
    expect(moveCalendarDate("2028-01-31", "month", 1)).toBe("2028-02-29");
  });
});
