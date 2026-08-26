import { describe, expect, it } from "vitest";

import {
  hashIdempotencyPayload,
  normalizeIdempotencyPayload,
} from "@/modules/schedule/normalize-idempotency-payload";

describe("normalize-idempotency-payload", () => {
  it("produces stable hash regardless of key order", () => {
    const a = { title: "Plan", localTime: "20:00", startDate: "2026-01-01" };
    const b = { startDate: "2026-01-01", title: "Plan", localTime: "20:00" };

    expect(normalizeIdempotencyPayload(a)).toBe(normalizeIdempotencyPayload(b));
    expect(hashIdempotencyPayload(a)).toBe(hashIdempotencyPayload(b));
  });

  it("produces different hash for different payloads", () => {
    const a = { title: "A" };
    const b = { title: "B" };

    expect(hashIdempotencyPayload(a)).not.toBe(hashIdempotencyPayload(b));
  });

  it("handles nested objects with stable key order", () => {
    const a = { outer: { z: 1, a: 2 }, list: [1, 2] };
    const b = { list: [1, 2], outer: { a: 2, z: 1 } };

    expect(hashIdempotencyPayload(a)).toBe(hashIdempotencyPayload(b));
  });
});
