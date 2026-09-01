import { describe, expect, it } from "vitest";

import {
  assertCapacityResultShape,
  parseCapacityTier,
  unavailableMetric,
} from "../../../scripts/lib/capacity-metrics";
import { assertSyntheticEnvironment } from "../../../scripts/lib/synthetic-env-guard";

describe("capacity metrics helpers", () => {
  it("C03: parses valid tiers and rejects invalid", () => {
    expect(parseCapacityTier(["--tier", "100"])).toBe(100);
    expect(parseCapacityTier(["--tier", "1000"])).toBe(1000);
    expect(parseCapacityTier(["--tier", "10000"])).toBe(10000);
    expect(() => parseCapacityTier([])).toThrow(/Usage/);
    expect(() => parseCapacityTier(["--tier", "50"])).toThrow(/Invalid tier/);
  });

  it("C03: unavailable metrics carry reason instead of null", () => {
    const metric = unavailableMetric("pg_stat_statements extension is not installed");
    expect(metric).toEqual({
      status: "unavailable",
      reason: "pg_stat_statements extension is not installed",
    });
  });

  it("C03: result shape requires connections/queue/slow/export/deletion/resources", () => {
    expect(
      assertCapacityResultShape({
        tier: 100,
        connections: { status: "measured", value: {} },
        queueDepth: { status: "measured", value: {} },
        slowQueries: unavailableMetric("n/a"),
        export: { status: "measured", value: {} },
        deletion: { status: "measured", value: {} },
        resources: { status: "measured", value: {} },
        totalElapsedMs: 1,
      }),
    ).toEqual([]);
    expect(assertCapacityResultShape({ tier: 100 })).toContain("deletion");
  });

  it("C03: synthetic guard fails closed without opt-in", () => {
    const previous = process.env.BRAIN_DANCE_SYNTHETIC;
    delete process.env.BRAIN_DANCE_SYNTHETIC;
    const result = assertSyntheticEnvironment();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/BRAIN_DANCE_SYNTHETIC/);
    }
    if (previous === undefined) {
      delete process.env.BRAIN_DANCE_SYNTHETIC;
    } else {
      process.env.BRAIN_DANCE_SYNTHETIC = previous;
    }
  });
});
