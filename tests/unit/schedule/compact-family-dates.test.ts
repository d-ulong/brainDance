import { describe, expect, it } from "vitest";

import {
  compactFamilyDates,
  formatCompactDateSegments,
  truncateSegments,
} from "@/modules/schedule/compact-family-dates";

describe("compactFamilyDates", () => {
  it("compacts a contiguous run into an inclusive range", () => {
    expect(compactFamilyDates(["2026-09-01", "2026-09-02", "2026-09-03"])).toEqual([
      { kind: "range", from: "2026-09-01", to: "2026-09-03" },
    ]);
  });

  it("keeps disjoint groups separate and preserves singletons", () => {
    expect(
      compactFamilyDates(["2026-09-01", "2026-09-02", "2026-09-05", "2026-09-10"]),
    ).toEqual([
      { kind: "range", from: "2026-09-01", to: "2026-09-02" },
      { kind: "single", date: "2026-09-05" },
      { kind: "single", date: "2026-09-10" },
    ]);
  });

  it("returns empty for empty input and formats/truncates for expand UI", () => {
    expect(compactFamilyDates([])).toEqual([]);
    const segments = compactFamilyDates([
      "2026-09-01",
      "2026-09-02",
      "2026-09-05",
      "2026-09-08",
      "2026-09-09",
    ]);
    expect(formatCompactDateSegments(segments)).toEqual([
      "2026-09-01 至 2026-09-02",
      "2026-09-05",
      "2026-09-08 至 2026-09-09",
    ]);
    expect(truncateSegments(segments, 2)).toEqual({
      visible: segments.slice(0, 2),
      hidden: 1,
      truncated: true,
    });
    expect(truncateSegments(segments, 10).truncated).toBe(false);
  });
});
