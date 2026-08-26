import { describe, expect, it } from "vitest";

import { horizonThrough } from "@/modules/time-policy/horizon-through";

describe("horizonThrough", () => {
  const now = new Date("2026-01-01T04:00:00.000Z");

  it("returns cap when end_date is null", () => {
    expect(horizonThrough({ end_date: null }, now)).toBe("2026-01-31");
  });

  it("returns cap when end_date is undefined", () => {
    expect(horizonThrough({}, now)).toBe("2026-01-31");
  });

  it("returns end_date when it is earlier than the 30-day cap", () => {
    expect(horizonThrough({ end_date: "2026-01-15" }, now)).toBe("2026-01-15");
  });

  it("returns cap when end_date equals the 30-day cap", () => {
    expect(horizonThrough({ end_date: "2026-01-31" }, now)).toBe("2026-01-31");
  });

  it("returns cap when end_date is later than the 30-day cap", () => {
    expect(horizonThrough({ end_date: "2026-03-01" }, now)).toBe("2026-01-31");
  });
});
