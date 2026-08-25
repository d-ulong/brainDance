import { pgTable, serial, timestamp } from "drizzle-orm/pg-core";

/**
 * Infrastructure-only table to verify the migration pipeline.
 * Not a domain / business entity — business tables arrive in Phase 1+.
 */
export const bootstrapMeta = pgTable("_bootstrap_meta", {
  id: serial("id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
