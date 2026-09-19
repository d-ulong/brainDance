import { describe, expect, it } from "vitest";

import {
  planFromDefinition,
  roundTripPlanDefinition,
  toPlanDefinition,
} from "@/lib/plans/plan-draft-serialization";

describe("plan draft serialization", () => {
  const sample = {
    title: "原计划",
    startDate: "2026-09-19",
    entries: [
      {
        key: "existing-key",
        title: "阅读",
        expectedTime: "17:00",
        latestStartTime: "17:10",
        durationMinutes: 20,
        repeat: { kind: "daily" as const },
        points: { onTimeWithin: 10, onTimeOver: 5, lateWithin: 3, lateOver: 1, incomplete: -2 },
      },
    ],
  };

  it("preserves scoring, timing, and keys on round trip", () => {
    const roundTripped = roundTripPlanDefinition(sample);
    expect(roundTripped.entries[0]).toEqual(sample.entries[0]);
  });

  it("preserves fields when only the plan title changes", () => {
    const drafts = planFromDefinition(sample);
    const saved = toPlanDefinition("新标题", "", sample.startDate, drafts);
    expect(saved.title).toBe("新标题");
    expect(saved.entries[0].key).toBe("existing-key");
    expect(saved.entries[0].latestStartTime).toBe("17:10");
    expect(saved.entries[0].durationMinutes).toBe(20);
    expect(saved.entries[0].points).toEqual(sample.entries[0].points);
  });
});
