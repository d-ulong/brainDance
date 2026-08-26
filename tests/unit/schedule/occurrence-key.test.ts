import { describe, expect, it } from "vitest";

import { buildOccurrenceKey, formatLocalTimeForKey } from "@/modules/schedule/occurrence-key";

describe("occurrence-key", () => {
  it("builds frozen key format with HH:MM local time", () => {
    const key = buildOccurrenceKey({
      planId: "plan-1",
      planVersionId: "version-1",
      familyDate: "2026-01-01",
      localTime: "20:00:00",
    });

    expect(key).toBe("plan-1:version-1:2026-01-01:daily:20:00");
  });

  it("normalizes local time with seconds", () => {
    expect(formatLocalTimeForKey("20:30:00")).toBe("20:30");
  });
});
