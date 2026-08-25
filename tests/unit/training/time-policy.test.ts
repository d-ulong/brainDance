import { describe, expect, it } from "vitest";

import { resolveAgeBand } from "@/modules/time-policy/resolve-age-band";
import { toFamilyDate } from "@/modules/time-policy/to-family-date";

describe("time policy", () => {
  it("maps UTC instant to Asia/Shanghai family date", () => {
    const familyDate = toFamilyDate(new Date("2026-01-01T16:00:00.000Z"));
    expect(familyDate).toBe("2026-01-02");
  });

  it("resolves age bands from birth date", () => {
    expect(resolveAgeBand(new Date("2020-01-01"), new Date("2026-01-01"))).toBe("5-8");
    expect(resolveAgeBand(new Date("2014-01-01"), new Date("2026-01-01"))).toBe("9-12");
    expect(resolveAgeBand(new Date("2008-01-01"), new Date("2026-01-01"))).toBe("13-18");
  });
});
