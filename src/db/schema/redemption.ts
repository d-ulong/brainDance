import {
  boolean,
  check,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { users } from "./identity";
import { pointLedgerEntries } from "./points";

export const redemptionCatalogItems = pgTable(
  "redemption_catalog_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => users.id),
    creatorParentId: uuid("creator_parent_id")
      .notNull()
      .references(() => users.id),
    title: text("title").notNull(),
    description: text("description"),
    cost: integer("cost").notNull(),
    monthlyLimit: integer("monthly_limit"),
    active: boolean("active").notNull().default(true),
    createIdempotencyKey: text("create_idempotency_key").notNull(),
    createIdempotencyPayloadHash: text("create_idempotency_payload_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    check("redemption_catalog_items_cost_check", sql`${table.cost} > 0`),
    check(
      "redemption_catalog_items_monthly_limit_check",
      sql`${table.monthlyLimit} IS NULL OR ${table.monthlyLimit} > 0`,
    ),
    unique("redemption_catalog_items_creator_create_idempotency_unique").on(
      table.creatorParentId,
      table.createIdempotencyKey,
    ),
  ],
);

export const pointRedemptions = pgTable(
  "point_redemptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => users.id),
    catalogItemId: uuid("catalog_item_id")
      .notNull()
      .references(() => redemptionCatalogItems.id),
    costSnapshot: integer("cost_snapshot").notNull(),
    requestMonth: text("request_month").notNull(),
    status: text("status").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    confirmedBy: uuid("confirmed_by").references(() => users.id),
    rejectionReason: text("rejection_reason"),
    ledgerEntryId: uuid("ledger_entry_id").references(() => pointLedgerEntries.id),
    createIdempotencyKey: text("create_idempotency_key").notNull(),
    createIdempotencyPayloadHash: text("create_idempotency_payload_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    check("point_redemptions_cost_snapshot_check", sql`${table.costSnapshot} > 0`),
    check(
      "point_redemptions_status_check",
      sql`${table.status} IN ('pending', 'approved', 'rejected', 'cancelled')`,
    ),
    check(
      "point_redemptions_request_month_check",
      sql`${table.requestMonth} ~ '^[0-9]{4}-[0-9]{2}$'`,
    ),
    check(
      "point_redemptions_state_invariants_check",
      sql`(
        (${table.status} = 'pending' AND ${table.confirmedAt} IS NULL AND ${table.confirmedBy} IS NULL AND ${table.ledgerEntryId} IS NULL AND ${table.rejectionReason} IS NULL)
        OR (${table.status} = 'approved' AND ${table.confirmedAt} IS NOT NULL AND ${table.confirmedBy} IS NOT NULL AND ${table.ledgerEntryId} IS NOT NULL AND ${table.rejectionReason} IS NULL)
        OR (${table.status} = 'rejected' AND ${table.confirmedAt} IS NOT NULL AND ${table.confirmedBy} IS NOT NULL AND ${table.ledgerEntryId} IS NULL AND ${table.rejectionReason} IS NOT NULL AND length(trim(${table.rejectionReason})) > 0)
        OR (${table.status} = 'cancelled' AND ${table.confirmedAt} IS NOT NULL AND ${table.confirmedBy} IS NOT NULL AND ${table.ledgerEntryId} IS NULL AND ${table.rejectionReason} IS NULL)
      )`,
    ),
    unique("point_redemptions_student_create_idempotency_unique").on(
      table.studentId,
      table.createIdempotencyKey,
    ),
    uniqueIndex("point_redemptions_ledger_entry_unique")
      .on(table.ledgerEntryId)
      .where(sql`${table.ledgerEntryId} IS NOT NULL`),
  ],
);
