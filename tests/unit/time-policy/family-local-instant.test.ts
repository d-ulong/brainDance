import { describe, expect, it } from "vitest";

import { completionWindowEnd } from "@/modules/time-policy/completion-window";
import { familyLocalInstant } from "@/modules/time-policy/family-local-instant";
import { toScheduledAt } from "@/modules/time-policy/to-scheduled-at";

describe("familyLocalInstant", () => {
  it("converts family local date and time to UTC", () => {
    expect(familyLocalInstant("2026-01-01", "20:00:00.000")).toEqual(
      new Date("2026-01-01T12:00:00.000Z"),
    );
  });

  it("supports millisecond precision for completion window boundaries", () => {
    expect(familyLocalInstant("2026-01-02", "23:59:59.999")).toEqual(
      new Date("2026-01-02T15:59:59.999Z"),
    );
  });

  it("is the shared conversion source for toScheduledAt", () => {
    expect(toScheduledAt("2026-01-01", "20:00")).toEqual(
      familyLocalInstant("2026-01-01", "20:00:00.000"),
    );
  });

  it("is the shared conversion source for completionWindowEnd", () => {
    expect(completionWindowEnd("2026-01-01")).toEqual(
      familyLocalInstant("2026-01-02", "23:59:59.999"),
    );
  });
});
