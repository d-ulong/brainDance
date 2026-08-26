import { describe, expect, it } from "vitest";

import { deriveCompletionKind } from "@/modules/time-policy/derive-completion-kind";

describe("deriveCompletionKind", () => {
  const familyDate = "2026-01-01";

  it("returns on_time when occurred family date matches item family date", () => {
    const occurredAt = new Date("2026-01-01T04:00:00.000Z");
    expect(deriveCompletionKind(occurredAt, familyDate)).toBe("on_time");
  });

  it("returns late when occurred family date is the next family day", () => {
    const occurredAt = new Date("2026-01-01T18:00:00.000Z");
    expect(deriveCompletionKind(occurredAt, familyDate)).toBe("late");
  });

  it("throws for family dates outside on_time and late derivation", () => {
    const occurredAt = new Date("2026-01-02T16:00:00.000Z");
    expect(() => deriveCompletionKind(occurredAt, familyDate)).toThrow(
      /Cannot derive completion kind/,
    );
  });
});
