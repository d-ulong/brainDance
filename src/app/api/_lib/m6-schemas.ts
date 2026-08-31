import { z } from "zod";

export const createRedemptionCatalogBodySchema = z.object({
  title: z.string().min(1).max(256),
  description: z.string().max(2000).nullable().optional(),
  cost: z.number().int().positive(),
  monthlyLimit: z.number().int().positive().nullable().optional(),
});

export const updateRedemptionCatalogBodySchema = z.object({
  title: z.string().min(1).max(256).optional(),
  description: z.string().max(2000).nullable().optional(),
  cost: z.number().int().positive().optional(),
  monthlyLimit: z.number().int().positive().nullable().optional(),
  active: z.boolean().optional(),
});

export const createRedemptionBodySchema = z.object({
  catalogItemId: z.string().uuid(),
});

export const rejectRedemptionBodySchema = z.object({
  reason: z.string().min(1).max(500),
});
