import { describe, expect, it } from "vitest";

import { nextFamilyDate } from "@/modules/time-policy/next-family-date";

describe("nextFamilyDate", () => {
  it("returns the next family date for a midday UTC instant", () => {
    expect(nextFamilyDate(new Date("2026-01-01T04:00:00.000Z"))).toBe("2026-01-02");
  });

  it("maps UTC instant before Asia/Shanghai midnight to the same family date plus one", () => {
    expect(nextFamilyDate(new Date("2026-01-01T15:59:59.999Z"))).toBe("2026-01-02");
  });

  it("maps UTC instant at Asia/Shanghai midnight boundary to the next family date", () => {
    expect(nextFamilyDate(new Date("2026-01-01T16:00:00.000Z"))).toBe("2026-01-03");
  });

  it("crosses month boundaries", () => {
    expect(nextFamilyDate(new Date("2026-01-31T12:00:00.000Z"))).toBe("2026-02-01");
  });

  it("crosses year boundaries", () => {
    expect(nextFamilyDate(new Date("2025-12-31T12:00:00.000Z"))).toBe("2026-01-01");
  });
});
