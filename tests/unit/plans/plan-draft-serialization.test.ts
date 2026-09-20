import { describe, expect, it } from "vitest";

import {
  appendPlanDraftEntry,
  blankPlanEntry,
  planFromDefinition,
  roundTripPlanDefinition,
  toPlanDefinition,
  validatePlanDraftEntries,
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

  it("assigns unique keys after delete then add (F03)", () => {
    const remaining = [blankPlanEntry(1)];
    remaining.push(appendPlanDraftEntry(remaining));
    const keys = remaining.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(["item-2", "item-3"]);
  });

  it("does not restore stale weekdays when all are deselected (F04)", () => {
    const source = {
      title: "weekly",
      startDate: "2026-09-19",
      entries: [
        {
          key: "weekly",
          title: "Read",
          expectedTime: "17:00",
          latestStartTime: null,
          durationMinutes: null,
          repeat: { kind: "weekly" as const, weekdays: [1, 3] },
          points: {
            onTimeWithin: 10,
            onTimeOver: 0,
            lateWithin: 0,
            lateOver: 0,
            incomplete: 0,
          },
        },
      ],
    };
    const draft = planFromDefinition(source);
    draft[0].weeklyWeekdays = [];
    expect(validatePlanDraftEntries(draft)).toMatch(/至少选择一天/);
    const actual = toPlanDefinition(source.title, "", source.startDate, draft);
    expect(actual.entries[0].repeat).toEqual({ kind: "weekly", weekdays: [] });
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
