import { z } from "zod";
import { executionChecklistSchema, pomodoroSchema } from "./execution-state";

export const executionBodySchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    checklist: executionChecklistSchema.optional(),
    pomodoroAction: z.enum(["start", "pause", "resume", "stop"]).optional(),
    subtaskId: z.string().trim().min(1).max(128).optional(),
    pomodoro: pomodoroSchema.optional(),
    reason: z.string().trim().min(2).max(500).optional(),
    startedAt: z.string().datetime().optional(),
    completedAt: z.string().datetime().optional(),
    durationMinutes: z.number().positive().max(1440).optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (body.completedAt && body.durationMinutes !== undefined)
      ctx.addIssue({ code: "custom", message: "结束时间和完成时长只能填写一项" });
    if (body.subtaskId && !body.pomodoroAction)
      ctx.addIssue({ code: "custom", message: "子任务计时需要指定操作" });
  });
