import { describe, expect, it } from "vitest";

import { familyDateRange } from "@/modules/time-policy/family-date-range";

describe("familyDateRange", () => {
  it("returns a closed interval of family dates", () => {
    expect(familyDateRange("2026-01-01", "2026-01-03")).toEqual([
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
    ]);
  });

  it("returns a single element when from equals through", () => {
    expect(familyDateRange("2026-01-01", "2026-01-01")).toEqual(["2026-01-01"]);
  });

  it("returns an empty array when from is after through", () => {
    expect(familyDateRange("2026-01-05", "2026-01-01")).toEqual([]);
  });

  it("crosses month boundaries", () => {
    expect(familyDateRange("2026-01-30", "2026-02-02")).toEqual([
      "2026-01-30",
      "2026-01-31",
      "2026-02-01",
      "2026-02-02",
    ]);
  });

  it("crosses leap day", () => {
    expect(familyDateRange("2024-02-28", "2024-03-01")).toEqual([
      "2024-02-28",
      "2024-02-29",
      "2024-03-01",
    ]);
  });
});
