import { describe, expect, it } from "vitest";

import { addFamilyDays } from "@/modules/time-policy/add-family-days";
import {
  isFamilyDateInTrendWindow,
  resolveTrendWindowStart,
} from "@/modules/training/trend-window";

describe("trend window boundaries", () => {
  const referenceFamilyDate = "2026-08-31";

  it("AC-M5-05: 7d window includes six prior days plus reference day", () => {
    expect(resolveTrendWindowStart("7d", referenceFamilyDate)).toBe("2026-08-25");
    expect(isFamilyDateInTrendWindow("2026-08-25", "7d", referenceFamilyDate)).toBe(true);
    expect(isFamilyDateInTrendWindow("2026-08-24", "7d", referenceFamilyDate)).toBe(false);
    expect(isFamilyDateInTrendWindow(referenceFamilyDate, "7d", referenceFamilyDate)).toBe(true);
  });

  it("AC-M5-05: 30d window includes twenty-nine prior days plus reference day", () => {
    const start = resolveTrendWindowStart("30d", referenceFamilyDate);
    expect(start).toBe(addFamilyDays(referenceFamilyDate, -29));
    expect(isFamilyDateInTrendWindow(start!, "30d", referenceFamilyDate)).toBe(true);
    expect(isFamilyDateInTrendWindow(addFamilyDays(start!, -1), "30d", referenceFamilyDate)).toBe(
      false,
    );
  });

  it("AC-M5-05: all window has no start boundary", () => {
    expect(resolveTrendWindowStart("all", referenceFamilyDate)).toBeNull();
    expect(isFamilyDateInTrendWindow("2020-01-01", "all", referenceFamilyDate)).toBe(true);
  });
});
