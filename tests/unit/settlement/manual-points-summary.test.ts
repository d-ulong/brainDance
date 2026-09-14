import { describe, expect, it } from "vitest";

import { maximumEntryPoints } from "@/modules/settlement/manual-points.service";

describe("maximumEntryPoints", () => {
  it("uses the highest configured successful outcome and never returns a negative maximum", () => {
    expect(maximumEntryPoints({ points: { onTime: 8, late: 3, incomplete: -2 } })).toBe(8);
    expect(maximumEntryPoints({ points: { success: -1, failure: -5 } })).toBe(0);
    expect(maximumEntryPoints({ points: null })).toBe(0);
  });
});
