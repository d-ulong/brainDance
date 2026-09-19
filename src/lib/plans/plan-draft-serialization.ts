import { type PlanDefinitionDto } from "@/lib/client/m2-api";

export type PlanDraftEntry = {
  key: string;
  title: string;
  description: string;
  expectedTime: string;
  latestStartTime: string;
  durationMinutes: string;
  repeat: "once" | "daily" | "weekly" | "monthly";
  repeatValue: string;
  weeklyWeekdays: number[];
  points: [string, string, string, string, string];
};

export const blankPlanEntry = (index = 0): PlanDraftEntry => ({
  key: `item-${index + 1}`,
  title: "",
  description: "",
  expectedTime: "19:00",
  latestStartTime: "",
  durationMinutes: "",
  repeat: "daily",
  repeatValue: "",
  weeklyWeekdays: [],
  points: ["10", "0", "0", "0", "0"],
});

export function planFromDefinition(plan: PlanDefinitionDto): PlanDraftEntry[] {
  return plan.entries.map((entry, index) => ({
    key: entry.key || `item-${index + 1}`,
    title: entry.title,
    description: entry.description ?? "",
    expectedTime: entry.expectedTime,
    latestStartTime: entry.latestStartTime ?? "",
    durationMinutes:
      entry.durationMinutes !== null && entry.durationMinutes !== undefined
        ? String(entry.durationMinutes)
        : "",
    repeat: entry.repeat.kind as PlanDraftEntry["repeat"],
    repeatValue:
      entry.repeat.kind === "once"
        ? (entry.repeat.date ?? "")
        : entry.repeat.kind === "weekly"
          ? (entry.repeat.weekdays?.join(",") ?? "")
          : entry.repeat.kind === "monthly"
            ? (entry.repeat.days?.join(",") ?? "")
            : "",
    weeklyWeekdays:
      entry.repeat.kind === "weekly" ? [...(entry.repeat.weekdays ?? [])].sort((a, b) => a - b) : [],
    points: [
      String(entry.points.onTimeWithin),
      String(entry.points.onTimeOver),
      String(entry.points.lateWithin),
      String(entry.points.lateOver),
      String(entry.points.incomplete),
    ],
  }));
}

function repeatFromEntry(entry: PlanDraftEntry, startDate: string) {
  if (entry.repeat === "once") {
    return { kind: "once" as const, date: entry.repeatValue || startDate };
  }
  if (entry.repeat === "weekly") {
    const weekdays =
      entry.weeklyWeekdays.length > 0
        ? [...entry.weeklyWeekdays]
        : entry.repeatValue
            .split(",")
            .map(Number)
            .filter((value) => value >= 1 && value <= 7);
    return { kind: "weekly" as const, weekdays };
  }
  if (entry.repeat === "monthly") {
    return {
      kind: "monthly" as const,
      days: entry.repeatValue
        .split(",")
        .map(Number)
        .filter((value) => value >= 1 && value <= 31),
    };
  }
  return { kind: "daily" as const };
}

export function toPlanDefinition(
  title: string,
  description: string,
  startDate: string,
  entries: PlanDraftEntry[],
): PlanDefinitionDto {
  return {
    title,
    description: description.trim() || undefined,
    startDate,
    entries: entries.map((entry, index) => ({
      key: entry.key.trim() || `item-${index + 1}`,
      title: entry.title,
      description: entry.description.trim() || undefined,
      expectedTime: entry.expectedTime,
      latestStartTime: entry.latestStartTime.trim() ? entry.latestStartTime : null,
      durationMinutes: entry.durationMinutes.trim() ? Number(entry.durationMinutes) : null,
      repeat: repeatFromEntry(entry, startDate),
      points: {
        onTimeWithin: Number(entry.points[0]),
        onTimeOver: Number(entry.points[1]),
        lateWithin: Number(entry.points[2]),
        lateOver: Number(entry.points[3]),
        incomplete: Number(entry.points[4]),
      },
    })),
  };
}

/** Round-trip helper for tests and review scripts. */
export function roundTripPlanDefinition(plan: PlanDefinitionDto): PlanDefinitionDto {
  return toPlanDefinition(
    plan.title,
    plan.description ?? "",
    plan.startDate,
    planFromDefinition(plan),
  );
}
