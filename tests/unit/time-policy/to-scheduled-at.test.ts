import { describe, expect, it } from "vitest";

import { familyLocalInstant } from "@/modules/time-policy/family-local-instant";
import { toScheduledAt } from "@/modules/time-policy/to-scheduled-at";

describe("toScheduledAt", () => {
  it("converts HH:mm family local time to UTC", () => {
    expect(toScheduledAt("2026-01-01", "20:00")).toEqual(new Date("2026-01-01T12:00:00.000Z"));
  });

  it("converts HH:mm:ss family local time to UTC", () => {
    expect(toScheduledAt("2026-01-01", "20:00:30")).toEqual(new Date("2026-01-01T12:00:30.000Z"));
  });

  it("rolls the UTC calendar day back when local time is before UTC+8 offset", () => {
    expect(toScheduledAt("2026-01-01", "02:00")).toEqual(new Date("2025-12-31T18:00:00.000Z"));
  });

  it("maps midnight family local time to the previous UTC day evening", () => {
    expect(toScheduledAt("2026-01-01", "00:00")).toEqual(new Date("2025-12-31T16:00:00.000Z"));
  });

  it("uses the shared familyLocalInstant conversion primitive", () => {
    expect(toScheduledAt("2026-01-01", "20:00:30")).toEqual(
      familyLocalInstant("2026-01-01", "20:00:30.000"),
    );
  });
});
