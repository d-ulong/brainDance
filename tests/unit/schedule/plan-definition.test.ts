import { describe, expect, it } from "vitest";

import {
  generatePlanOccurrences,
  planDefinitionSchema,
  scorePlanEntry,
  type PlanDefinition,
  type PlanEntry,
  type RepeatRule,
} from "@/modules/schedule/plan-definition";

function entry(overrides: Partial<PlanEntry> = {}): PlanEntry {
  return {
    key: "reading",
    title: "阅读",
    expectedTime: "18:30",
    latestStartTime: "19:00",
    durationMinutes: 30,
    repeat: { kind: "daily" },
    points: { onTimeWithin: 10, onTimeOver: 5, lateWithin: 3, lateOver: 0, incomplete: -2 },
    ...overrides,
  };
}
function plan(overrides: Partial<PlanDefinition> = {}): PlanDefinition {
  return {
    title: "学习",
    startDate: "2024-01-01",
    endDate: "2024-12-31",
    entries: [entry()],
    ...overrides,
  };
}
const instant = (time: string) => new Date(`2024-02-29T${time}+08:00`);

describe("plan definition validation", () => {
  it("normalizes labels and repeat choices without mutating input", () => {
    const value = plan({
      title: " 学习 ",
      entries: [entry({ repeat: { kind: "weekly", weekdays: [7, 1, 3] } })],
    });
    expect(planDefinitionSchema.parse(value)).toMatchObject({
      title: "学习",
      entries: [{ repeat: { weekdays: [1, 3, 7] } }],
    });
    expect(value.entries[0].repeat).toEqual({ kind: "weekly", weekdays: [7, 1, 3] });
  });
  it("preserves an optional plan description alongside its title", () => {
    expect(planDefinitionSchema.parse(plan({ description: " 放学后先阅读，再进行运动。 " }))).toMatchObject({
      title: "学习",
      description: "放学后先阅读，再进行运动。",
    });
  });
  it.each([
    plan({ startDate: "2023-02-29" }),
    plan({ startDate: "2024-04-31" }),
    plan({ startDate: "2025-01-01" }),
    plan({ entries: [] }),
    plan({ entries: [entry(), entry()] }),
    plan({ entries: [entry({ startDate: "2023-12-31" })] }),
    plan({ entries: [entry({ endDate: "2025-01-01" })] }),
    plan({ entries: [entry({ startDate: "2024-06-01", endDate: "2024-05-31" })] }),
    plan({ entries: [entry({ expectedTime: "24:00" })] }),
    plan({ entries: [entry({ latestStartTime: "18:29" })] }),
    plan({ entries: [entry({ durationMinutes: 0 })] }),
    plan({ entries: [entry({ durationMinutes: 1.5 })] }),
    plan({ entries: [entry({ repeat: { kind: "once", date: "2025-01-01" } })] }),
    plan({ entries: [entry({ repeat: { kind: "weekly", weekdays: [] } })] }),
    plan({ entries: [entry({ repeat: { kind: "weekly", weekdays: [0] } })] }),
    plan({ entries: [entry({ repeat: { kind: "weekly", weekdays: [1, 1] } })] }),
    plan({ entries: [entry({ repeat: { kind: "monthly", days: [32] } })] }),
    plan({ entries: [entry({ points: { ...entry().points, incomplete: -2_147_483_649 } })] }),
    plan({ entries: [entry({ points: { ...entry().points, onTimeWithin: 2_147_483_648 } })] }),
    plan({ entries: [entry({ points: { ...entry().points, onTimeWithin: 1.5 } })] }),
  ])("rejects invalid definition %#", (value) => {
    expect(planDefinitionSchema.safeParse(value).success).toBe(false);
  });
  it("accepts an optional entry description max 500 characters", () => {
    const ok = plan({ entries: [entry({ description: "x".repeat(500) })] });
    expect(planDefinitionSchema.safeParse(ok).success).toBe(true);
    expect(planDefinitionSchema.parse(ok).entries[0]?.description).toHaveLength(500);
  });
  it("rejects entry descriptions longer than 500 characters and allows omitted descriptions", () => {
    expect(planDefinitionSchema.safeParse(plan({ entries: [entry({ description: "x".repeat(501) })] })).success).toBe(false);
    expect(planDefinitionSchema.safeParse(plan({ entries: [entry()] })).success).toBe(true);
  });

  it("allows zero and signed storage-boundary points without a daily cap", () => {
    expect(
      planDefinitionSchema.safeParse(
        plan({
          entries: [
            entry({
              points: {
                onTimeWithin: 2_147_483_647,
                onTimeOver: 0,
                lateWithin: -1,
                lateOver: -2,
                incomplete: -2_147_483_648,
              },
            }),
          ],
        }),
      ).success,
    ).toBe(true);
  });
});

describe("plan occurrences", () => {
  it.each<[RepeatRule, string[]]>([
    [{ kind: "once", date: "2024-02-29" }, ["2024-02-29"]],
    [
      { kind: "daily" },
      ["2024-02-28", "2024-02-29", "2024-03-01", "2024-03-02", "2024-03-03", "2024-03-04"],
    ],
    [{ kind: "weekly", weekdays: [1, 7] }, ["2024-03-03", "2024-03-04"]],
    [{ kind: "monthly", days: [1, 29, 31] }, ["2024-02-29", "2024-03-01"]],
  ])("expands %j over leap day and week/month boundaries", (repeat, expected) => {
    const value = plan({ entries: [entry({ repeat })] });
    expect(
      generatePlanOccurrences(value, "2024-02-28", "2024-03-04").map((item) => item.familyDate),
    ).toEqual(expected);
  });
  it("skips non-existent monthly dates instead of moving them to month end", () => {
    const value = plan({
      startDate: "2023-01-01",
      endDate: "2023-04-30",
      entries: [entry({ repeat: { kind: "monthly", days: [29, 31] } })],
    });
    expect(
      generatePlanOccurrences(value, "2023-02-01", "2023-04-30").map((item) => item.familyDate),
    ).toEqual(["2023-03-29", "2023-03-31", "2023-04-29"]);
  });
  it("intersects plan, entry and request bounds inclusively with stable chronological order", () => {
    const value = plan({
      startDate: "2024-02-28",
      endDate: "2024-03-02",
      entries: [
        entry({ key: "late", startDate: "2024-02-29", endDate: "2024-03-01" }),
        entry({ key: "early", expectedTime: "08:00" }),
      ],
    });
    const occurrences = generatePlanOccurrences(value, "2024-02-01", "2024-03-01");
    expect(occurrences.map((item) => `${item.familyDate}:${item.entry.key}`)).toEqual([
      "2024-02-28:early",
      "2024-02-29:early",
      "2024-02-29:late",
      "2024-03-01:early",
      "2024-03-01:late",
    ]);
    expect(occurrences[0].scheduledAt.toISOString()).toBe("2024-02-28T00:00:00.000Z");
  });
  it("preserves two same-time entries; overlapping requests produce the same occurrence identities", () => {
    const value = plan({ entries: [entry(), entry({ key: "sport" })] });
    const a = generatePlanOccurrences(value, "2024-02-28", "2024-03-01");
    const b = generatePlanOccurrences(value, "2024-02-29", "2024-03-02");
    expect(a.filter((item) => item.familyDate >= "2024-02-29")).toEqual(
      b.filter((item) => item.familyDate <= "2024-03-01"),
    );
    expect(a).toHaveLength(6);
  });
  it("returns no occurrences outside validity or reversed windows, and rejects invalid dates", () => {
    expect(generatePlanOccurrences(plan(), "2025-01-01", "2025-01-02")).toEqual([]);
    expect(generatePlanOccurrences(plan(), "2024-02-02", "2024-02-01")).toEqual([]);
    expect(() => generatePlanOccurrences(plan(), "2024-02-30", "2024-03-01")).toThrow();
  });
});

describe("conditional points", () => {
  it.each([
    ["18:50:00", "19:15:00", "onTimeWithin", 10],
    ["19:00:00", "19:30:00", "onTimeWithin", 10],
    ["19:00:00", "19:30:00.001", "onTimeOver", 5],
    ["19:00:00.001", "19:30:00.001", "lateWithin", 3],
    ["19:01:00", "19:31:00.001", "lateOver", 0],
  ])("scores %s to %s exclusively as %s", (start, complete, condition, amount) => {
    expect(
      scorePlanEntry(entry(), {
        startedAt: instant(start),
        completedAt: instant(complete),
        familyDate: "2024-02-29",
      }),
    ).toEqual({ amount, condition });
  });
  it.each([null, "19:01:00"])("incomplete has its own result even if started (%s)", (start) => {
    expect(
      scorePlanEntry(entry(), {
        startedAt: start ? instant(start) : null,
        completedAt: null,
        familyDate: "2024-02-29",
      }),
    ).toEqual({ amount: -2, condition: "incomplete" });
  });
  it("duration-only ignores lateness but distinguishes elapsed time", () => {
    const value = entry({ latestStartTime: null });
    expect(
      scorePlanEntry(value, {
        startedAt: instant("21:00:00"),
        completedAt: instant("21:30:00"),
        familyDate: "2024-02-29",
      }).condition,
    ).toBe("onTimeWithin");
    expect(
      scorePlanEntry(value, {
        startedAt: instant("21:00:00"),
        completedAt: instant("21:30:01"),
        familyDate: "2024-02-29",
      }).condition,
    ).toBe("onTimeOver");
  });
  it("without duration only completion matters, even when a latest time is present", () => {
    const value = entry({ durationMinutes: null });
    expect(
      scorePlanEntry(value, {
        startedAt: null,
        completedAt: instant("23:00:00"),
        familyDate: "2024-02-29",
      }),
    ).toEqual({ amount: 10, condition: "onTimeWithin" });
    expect(
      scorePlanEntry(value, { startedAt: null, completedAt: null, familyDate: "2024-02-29" })
        .condition,
    ).toBe("incomplete");
  });
  it("refuses missing necessary or inconsistent timing facts instead of inventing points", () => {
    expect(() =>
      scorePlanEntry(entry(), {
        startedAt: null,
        completedAt: instant("19:00:00"),
        familyDate: "2024-02-29",
      }),
    ).toThrow("缺少实际开始时间");
    expect(() =>
      scorePlanEntry(entry(), {
        startedAt: instant("19:01:00"),
        completedAt: instant("19:00:00"),
        familyDate: "2024-02-29",
      }),
    ).toThrow("完成时间不能早于开始时间");
    expect(() =>
      scorePlanEntry(entry(), {
        startedAt: new Date(NaN),
        completedAt: null,
        familyDate: "2024-02-29",
      }),
    ).toThrow("执行时间无效");
  });
});
