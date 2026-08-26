import { describe, expect, it } from "vitest";

import {
  completionWindowEnd,
  isPastCompletionWindow,
  isWithinCompletionWindow,
} from "@/modules/time-policy/completion-window";
import { familyLocalInstant } from "@/modules/time-policy/family-local-instant";

describe("completion window", () => {
  const familyDate = "2026-01-01";

  it("ends at familyDate + 1 day 23:59:59.999 Asia/Shanghai", () => {
    expect(completionWindowEnd(familyDate)).toEqual(new Date("2026-01-02T15:59:59.999Z"));
  });

  it("is within at familyDate 00:00 Asia/Shanghai", () => {
    const now = new Date("2025-12-31T16:00:00.000Z");
    expect(isWithinCompletionWindow(familyDate, now)).toBe(true);
    expect(isPastCompletionWindow(familyDate, now)).toBe(false);
  });

  it("is within at familyDate 23:59:59.999 Asia/Shanghai", () => {
    const now = new Date("2026-01-01T15:59:59.999Z");
    expect(isWithinCompletionWindow(familyDate, now)).toBe(true);
    expect(isPastCompletionWindow(familyDate, now)).toBe(false);
  });

  it("is within at familyDate + 1 day 00:00 Asia/Shanghai", () => {
    const now = new Date("2026-01-01T16:00:00.000Z");
    expect(isWithinCompletionWindow(familyDate, now)).toBe(true);
    expect(isPastCompletionWindow(familyDate, now)).toBe(false);
  });

  it("is within at familyDate + 1 day 23:59:59.999 Asia/Shanghai", () => {
    const now = new Date("2026-01-02T15:59:59.999Z");
    expect(isWithinCompletionWindow(familyDate, now)).toBe(true);
    expect(isPastCompletionWindow(familyDate, now)).toBe(false);
  });

  it("is past at familyDate + 2 day 00:00 Asia/Shanghai", () => {
    const now = new Date("2026-01-02T16:00:00.000Z");
    expect(isWithinCompletionWindow(familyDate, now)).toBe(false);
    expect(isPastCompletionWindow(familyDate, now)).toBe(true);
  });

  it("is not within before familyDate starts", () => {
    const now = new Date("2025-12-31T15:59:59.999Z");
    expect(isWithinCompletionWindow(familyDate, now)).toBe(false);
    expect(isPastCompletionWindow(familyDate, now)).toBe(false);
  });

  it("uses the shared familyLocalInstant conversion primitive", () => {
    expect(completionWindowEnd(familyDate)).toEqual(
      familyLocalInstant("2026-01-02", "23:59:59.999"),
    );
    expect(isWithinCompletionWindow(familyDate, new Date("2025-12-31T16:00:00.000Z"))).toBe(
      isWithinCompletionWindow(familyDate, familyLocalInstant(familyDate, "00:00:00.000")),
    );
  });
});
