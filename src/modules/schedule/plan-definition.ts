import { z } from "zod";

import { ScheduleError } from "@/modules/schedule/errors";
import { toScheduledAt } from "@/modules/time-policy/to-scheduled-at";

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "日期不存在");
const timeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const pointsSchema = z.number().int().min(-2_147_483_648).max(2_147_483_647);
const uniqueNumbers = (max: number) =>
  z
    .array(z.number().int().min(1).max(max))
    .min(1)
    .refine((values) => new Set(values).size === values.length, "不能重复选择日期")
    .transform((values) => [...values].sort((a, b) => a - b));

const repeatRuleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("once"), date: dateSchema }).strict(),
  z.object({ kind: z.literal("daily") }).strict(),
  z.object({ kind: z.literal("weekly"), weekdays: uniqueNumbers(7) }).strict(),
  z.object({ kind: z.literal("monthly"), days: uniqueNumbers(31) }).strict(),
]);

const planEntrySchema = z
  .object({
    key: z.string().trim().min(1).max(128),
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(4000).optional(),
    startDate: dateSchema.nullish(),
    endDate: dateSchema.nullish(),
    expectedTime: timeSchema,
    latestStartTime: timeSchema.nullish(),
    durationMinutes: z.number().int().positive().max(2_147_483_647).nullish(),
    repeat: repeatRuleSchema,
    points: z
      .object({
        onTimeWithin: pointsSchema,
        onTimeOver: pointsSchema,
        lateWithin: pointsSchema,
        lateOver: pointsSchema,
        incomplete: pointsSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((entry, ctx) => {
    if (entry.startDate && entry.endDate && entry.startDate > entry.endDate) {
      ctx.addIssue({ code: "custom", path: ["endDate"], message: "结束日期不能早于起始日期" });
    }
    if (entry.latestStartTime && entry.latestStartTime < entry.expectedTime) {
      ctx.addIssue({
        code: "custom",
        path: ["latestStartTime"],
        message: "最晚开始不能早于预期时间",
      });
    }
  });

export const planDefinitionSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(4000).optional(),
    startDate: dateSchema,
    endDate: dateSchema.nullish(),
    entries: z.array(planEntrySchema).min(1),
  })
  .strict()
  .superRefine((plan, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: "custom", path, message });
    if (plan.endDate && plan.endDate < plan.startDate)
      issue(["endDate"], "结束日期不能早于起始日期");
    const keys = new Set<string>();
    plan.entries.forEach((entry, index) => {
      if (keys.has(entry.key)) issue(["entries", index, "key"], "内容项标识必须唯一");
      keys.add(entry.key);
      const start = entry.startDate ?? plan.startDate;
      const end = entry.endDate ?? plan.endDate;
      if (start < plan.startDate || (plan.endDate && start > plan.endDate)) {
        issue(["entries", index, "startDate"], "内容日期必须在计划范围内");
      }
      if (end && (end < start || (plan.endDate && end > plan.endDate))) {
        issue(["entries", index, "endDate"], "内容日期必须在计划范围内");
      }
      if (
        entry.repeat.kind === "once" &&
        (entry.repeat.date < start || (end && entry.repeat.date > end))
      ) {
        issue(["entries", index, "repeat", "date"], "单次日期必须在内容有效范围内");
      }
    });
  });

export type RepeatRule = z.infer<typeof repeatRuleSchema>;
export type PlanEntry = z.infer<typeof planEntrySchema>;
export type PlanDefinition = z.infer<typeof planDefinitionSchema>;

/** Pure recurrence expansion; binding bounds and write idempotency belong to the caller. */
export function generatePlanOccurrences(
  definition: PlanDefinition,
  from: string,
  through: string,
): {
  entry: PlanEntry;
  familyDate: string;
  scheduledAt: Date;
}[] {
  const plan = planDefinitionSchema.parse(definition);
  dateSchema.parse(from);
  dateSchema.parse(through);
  const start = from > plan.startDate ? from : plan.startDate;
  const end = plan.endDate && plan.endDate < through ? plan.endDate : through;
  const result: ReturnType<typeof generatePlanOccurrences> = [];
  // UTC calendar iteration avoids host timezone/DST and preserves four-digit years.
  const cursor = new Date(`${start}T00:00:00.000Z`);
  while (cursor.toISOString().slice(0, 10) <= end) {
    const familyDate = cursor.toISOString().slice(0, 10);
    for (const entry of plan.entries) {
      if (
        (entry.startDate && familyDate < entry.startDate) ||
        (entry.endDate && familyDate > entry.endDate)
      )
        continue;
      const repeat = entry.repeat;
      const matches =
        repeat.kind === "daily" ||
        (repeat.kind === "once" && repeat.date === familyDate) ||
        (repeat.kind === "weekly" && repeat.weekdays.includes(cursor.getUTCDay() || 7)) ||
        (repeat.kind === "monthly" && repeat.days.includes(cursor.getUTCDate()));
      if (matches)
        result.push({
          entry,
          familyDate,
          scheduledAt: toScheduledAt(familyDate, entry.expectedTime),
        });
    }
    if (familyDate === end) break;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
}

/** Caller owns the final settlement deadline and supplies authoritative execution facts. */
export function scorePlanEntry(
  entry: PlanEntry,
  facts: {
    startedAt: Date | null;
    completedAt: Date | null;
    familyDate: string;
  },
): { amount: number; condition: string } {
  const parsed = planEntrySchema.parse(entry);
  dateSchema.parse(facts.familyDate);
  const { startedAt, completedAt } = facts;
  if ([startedAt, completedAt].some((date) => date !== null && !Number.isFinite(date.getTime()))) {
    throw new ScheduleError("STATE_CONFLICT", "执行时间无效");
  }
  if (startedAt && completedAt && completedAt < startedAt) {
    throw new ScheduleError("STATE_CONFLICT", "完成时间不能早于开始时间");
  }
  let condition: keyof PlanEntry["points"];
  if (!completedAt) condition = "incomplete";
  else if (!parsed.durationMinutes) condition = "onTimeWithin";
  else {
    if (!startedAt) throw new ScheduleError("STATE_CONFLICT", "缺少实际开始时间，无法判定耗时积分");
    const within = completedAt.getTime() - startedAt.getTime() <= parsed.durationMinutes * 60_000;
    const late =
      parsed.latestStartTime != null &&
      startedAt > toScheduledAt(facts.familyDate, parsed.latestStartTime);
    condition = late
      ? within
        ? "lateWithin"
        : "lateOver"
      : within
        ? "onTimeWithin"
        : "onTimeOver";
  }
  return { amount: parsed.points[condition], condition };
}
