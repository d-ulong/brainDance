import { describe, expect, it } from "vitest";

import { addFamilyDays } from "@/modules/time-policy/add-family-days";

describe("addFamilyDays", () => {
  it("adds days within the same month", () => {
    expect(addFamilyDays("2026-01-15", 5)).toBe("2026-01-20");
  });

  it("crosses month boundaries", () => {
    expect(addFamilyDays("2026-01-30", 3)).toBe("2026-02-02");
  });

  it("crosses year boundaries", () => {
    expect(addFamilyDays("2025-12-31", 1)).toBe("2026-01-01");
  });

  it("handles leap day forward", () => {
    expect(addFamilyDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addFamilyDays("2024-02-29", 1)).toBe("2024-03-01");
  });

  it("handles leap day backward", () => {
    expect(addFamilyDays("2024-03-01", -1)).toBe("2024-02-29");
    expect(addFamilyDays("2024-02-29", -1)).toBe("2024-02-28");
  });

  it("subtracts days across month and year boundaries", () => {
    expect(addFamilyDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addFamilyDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("returns the same date when adding zero days", () => {
    expect(addFamilyDays("2026-06-15", 0)).toBe("2026-06-15");
  });
});
