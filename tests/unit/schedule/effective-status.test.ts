import { describe, expect, it } from "vitest";

import { effectiveStatus } from "@/modules/schedule/effective-status";

describe("effective-status", () => {
  const familyDate = "2026-01-01";

  it("returns persisted status when not pending", () => {
    expect(
      effectiveStatus({ status: "completed", familyDate }, new Date("2026-01-01T12:00:00.000Z")),
    ).toBe("completed");
  });

  it("returns expired for pending past completion window", () => {
    const now = new Date("2026-01-03T16:00:00.000Z");
    expect(effectiveStatus({ status: "pending", familyDate }, now)).toBe("expired");
  });

  it("returns pending inside completion window", () => {
    const now = new Date("2026-01-01T12:00:00.000Z");
    expect(effectiveStatus({ status: "pending", familyDate }, now)).toBe("pending");
  });
});
