import { z } from "zod";

export const createExportJobBodySchema = z.object({
  studentId: z.string().uuid(),
});

export const createDeletionRequestBodySchema = z.object({
  targetType: z.enum(["student_account", "daily_reflection"]),
  targetId: z.string().uuid(),
});

export const adminForceDeletionBodySchema = z.object({
  reason: z.string().min(1).max(1000),
});

export const deliverExportDownloadBodySchema = z.object({
  token: z.string().min(1),
});
