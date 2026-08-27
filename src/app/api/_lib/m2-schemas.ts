import { z } from "zod";

export const m2UuidParamSchema = z.string().uuid();

export const createFormalPlanBodySchema = z.object({
  title: z.string().min(1).max(256),
  description: z.string().max(2000).nullable().optional(),
  localTime: z.string().regex(/^\d{2}:\d{2}$/),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
});

export const editFormalPlanBodySchema = z.object({
  title: z.string().min(1).max(256).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  localTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable()
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
});

export const skipScheduleBodySchema = z.object({
  reason: z.string().max(500).nullable().optional(),
});

export const enablePointRuleBodySchema = z.object({
  templateId: z.literal("schedule_system_complete_v1"),
});

export const scheduleItemsQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const pointsLedgerQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
