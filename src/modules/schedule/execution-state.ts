import { z } from "zod";

import { ScheduleError } from "@/modules/schedule/errors";
import { addFamilyDays } from "@/modules/time-policy/add-family-days";
import { familyLocalInstant } from "@/modules/time-policy/family-local-instant";

export const pomodoroSchema = z
  .object({
    state: z.enum(["running", "paused", "stopped"]).optional(),
    startedAt: z.string().datetime().optional(),
    pausedAt: z.string().datetime().optional(),
    stoppedAt: z.string().datetime().optional(),
    pauseCount: z.number().int().nonnegative().optional(),
    pausedSeconds: z.number().int().nonnegative().optional(),
    focusedSeconds: z.number().int().nonnegative().optional(),
  })
  .strict();

const executionChecklistItemSchema = z
  .object({
    id: z.string().trim().min(1).max(128),
    title: z.string().trim().min(1).max(200),
    completed: z.boolean(),
    difficulty: z.string().trim().max(64).optional(),
    durationMinutes: z.number().positive().max(1440).optional(),
    startedAt: z.string().datetime().optional(),
    completedAt: z.string().datetime().optional(),
    pomodoro: pomodoroSchema.optional(),
  })
  .strict();
export const executionChecklistSchema = z
  .array(executionChecklistItemSchema)
  .max(30)
  .refine(
    (tasks) => new Set(tasks.map((task) => task.id)).size === tasks.length,
    "子任务标识不能重复",
  );

export type ChecklistTask = z.infer<typeof executionChecklistSchema>[number];
export type Pomodoro = z.infer<typeof pomodoroSchema>;
export type ExecutionSnapshot = {
  revision: number;
  taskType: "normal" | "homework" | "exercise";
  checklist: ChecklistTask[];
  pomodoro: Pomodoro;
  all_completed: boolean;
};

export function executionEditDeadline(familyDate: string, role: "parent" | "student"): Date {
  return familyLocalInstant(addFamilyDays(familyDate, role === "parent" ? 61 : 1), "00:00:00.000");
}

/** Read old JSON without discarding newly added metadata on the next update. */
export function readChecklist(value: unknown): ChecklistTask[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate: unknown, index) => {
    if (!candidate || typeof candidate !== "object") return [];
    const task = candidate as Record<string, unknown>;
    const parsed = executionChecklistItemSchema.safeParse({
      ...task,
      id: typeof task.id === "string" ? task.id : `check-${index + 1}`,
      completed: task.completed === true,
    });
    return parsed.success ? [parsed.data] : [];
  });
}

export function readPomodoro(value: unknown): Pomodoro {
  const result = pomodoroSchema.safeParse(value);
  return result.success ? result.data : {};
}

export function transitionPomodoro(
  previous: Pomodoro,
  action: "start" | "pause" | "resume" | "stop",
  now: Date,
): Pomodoro {
  const timer = { ...previous };
  if (action === "start") {
    if (timer.state)
      throw new ScheduleError("STATE_CONFLICT", "番茄钟已开始，请继续或停止当前计时");
    return {
      state: "running",
      startedAt: now.toISOString(),
      pauseCount: 0,
      pausedSeconds: 0,
      focusedSeconds: 0,
    };
  }
  if (action === "resume") {
    if (timer.state !== "paused" || !timer.pausedAt)
      throw new ScheduleError("STATE_CONFLICT", "番茄钟当前不处于暂停状态");
    timer.pausedSeconds =
      (timer.pausedSeconds ?? 0) +
      Math.max(0, Math.floor((now.getTime() - new Date(timer.pausedAt).getTime()) / 1000));
    timer.state = "running";
    delete timer.pausedAt;
  } else if (action === "pause") {
    if (timer.state !== "running") throw new ScheduleError("STATE_CONFLICT", "番茄钟尚未运行");
    timer.state = "paused";
    timer.pausedAt = now.toISOString();
    timer.pauseCount = (timer.pauseCount ?? 0) + 1;
  } else {
    if (timer.state !== "running" && timer.state !== "paused")
      throw new ScheduleError("STATE_CONFLICT", "番茄钟尚未运行");
    if (timer.pausedAt)
      timer.pausedSeconds =
        (timer.pausedSeconds ?? 0) +
        Math.max(0, Math.floor((now.getTime() - new Date(timer.pausedAt).getTime()) / 1000));
    timer.state = "stopped";
    timer.stoppedAt = now.toISOString();
    delete timer.pausedAt;
  }
  const end = timer.pausedAt ? new Date(timer.pausedAt) : now;
  timer.focusedSeconds = Math.max(
    0,
    Math.floor((end.getTime() - new Date(timer.startedAt ?? now).getTime()) / 1000) -
      (timer.pausedSeconds ?? 0),
  );
  return timer;
}

export function finishExecution(snapshot: ExecutionSnapshot, now: Date): ExecutionSnapshot {
  const finish = (timer: Pomodoro) => {
    if (timer.startedAt && new Date(timer.startedAt) > now)
      throw new ScheduleError("VALIDATION_ERROR", "完成时间不能早于番茄钟开始时间");
    if (timer.stoppedAt && new Date(timer.stoppedAt) > now)
      throw new ScheduleError("VALIDATION_ERROR", "完成时间不能早于番茄钟结束时间");
    return timer.state === "running" || timer.state === "paused"
      ? transitionPomodoro(timer, "stop", now)
      : timer;
  };
  return {
    ...snapshot,
    checklist: snapshot.checklist.map((task) => ({
      ...task,
      ...(task.pomodoro ? { pomodoro: finish(task.pomodoro) } : {}),
    })),
    pomodoro: finish(snapshot.pomodoro),
    all_completed: snapshot.checklist.every((task) => task.completed),
  };
}

/** Final manual corrections keep the elapsed-time arithmetic deterministic. */
export function validateFinalPomodoro(timer: Pomodoro, now: Date): Pomodoro {
  if (!timer.state) return {};
  if (timer.state !== "stopped" || !timer.startedAt || !timer.stoppedAt)
    throw new ScheduleError("VALIDATION_ERROR", "最终番茄钟需要有效的开始和停止时间");
  const start = new Date(timer.startedAt).getTime();
  const stop = new Date(timer.stoppedAt).getTime();
  const elapsed = Math.floor((stop - start) / 1000);
  if (
    !Number.isFinite(elapsed) ||
    elapsed < 0 ||
    stop > now.getTime() ||
    (timer.pausedSeconds ?? 0) > elapsed
  )
    throw new ScheduleError("VALIDATION_ERROR", "番茄钟最终耗时不正确");
  if (
    timer.focusedSeconds !== undefined &&
    timer.focusedSeconds !== elapsed - (timer.pausedSeconds ?? 0)
  )
    throw new ScheduleError("VALIDATION_ERROR", "专注时长须等于计时区间减去暂停时间");
  return { ...timer, pausedAt: undefined, focusedSeconds: elapsed - (timer.pausedSeconds ?? 0) };
}
