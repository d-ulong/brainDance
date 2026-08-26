import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  boolean,
  check,
  date,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { users } from "./identity";
import { scheduleItems } from "./schedule";

export const factVersions = pgTable(
  "fact_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scheduleItemId: uuid("schedule_item_id")
      .notNull()
      .references(() => scheduleItems.id),
    studentId: uuid("student_id")
      .notNull()
      .references(() => users.id),
    factKey: text("fact_key").notNull(),
    sourceKind: text("source_kind").notNull(),
    value: jsonb("value").$type<Record<string, unknown>>().notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    idempotencyPayloadHash: text("idempotency_payload_hash").notNull(),
    completionKind: text("completion_kind").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    assertedAt: timestamp("asserted_at", { withTimezone: true }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    confirmedBy: uuid("confirmed_by").references(() => users.id),
    supersedesFactVersionId: uuid("supersedes_fact_version_id").references(
      (): AnyPgColumn => factVersions.id,
    ),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "fact_versions_completion_kind_check",
      sql`${table.completionKind} IN ('on_time', 'late')`,
    ),
    unique("fact_versions_schedule_item_idempotency_unique").on(
      table.scheduleItemId,
      table.idempotencyKey,
    ),
  ],
);

export const pointRuleTemplates = pgTable("point_rule_templates", {
  id: text("id").primaryKey(),
  eventType: text("event_type").notNull(),
  parameterSchema: jsonb("parameter_schema").$type<Record<string, unknown>>().notNull(),
  effectSchema: jsonb("effect_schema").$type<Record<string, unknown>>().notNull(),
  negativeEffectSchema: jsonb("negative_effect_schema").$type<Record<string, unknown>>(),
  limits: jsonb("limits").$type<Record<string, unknown>>(),
  stackingMode: text("stacking_mode").notNull().default("none"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const pointRules = pgTable(
  "point_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => users.id),
    creatorParentId: uuid("creator_parent_id")
      .notNull()
      .references(() => users.id),
    templateId: text("template_id")
      .notNull()
      .references(() => pointRuleTemplates.id),
    active: boolean("active").notNull().default(false),
    createIdempotencyKey: text("create_idempotency_key").notNull(),
    createIdempotencyPayloadHash: text("create_idempotency_payload_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    unique("point_rules_creator_student_create_idempotency_unique").on(
      table.creatorParentId,
      table.studentId,
      table.createIdempotencyKey,
    ),
    uniqueIndex("point_rules_active_student_unique")
      .on(table.studentId)
      .where(sql`${table.active} = true`),
  ],
);

export const pointRuleVersions = pgTable(
  "point_rule_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pointRuleId: uuid("point_rule_id")
      .notNull()
      .references(() => pointRules.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    parameters: jsonb("parameters").$type<Record<string, unknown>>().notNull(),
    effect: jsonb("effect").$type<Record<string, unknown>>().notNull(),
    priority: integer("priority"),
    effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull(),
    status: text("status").notNull(),
  },
  (table) => [
    check("point_rule_versions_status_check", sql`${table.status} IN ('active', 'superseded')`),
    unique("point_rule_versions_rule_version_unique").on(table.pointRuleId, table.version),
  ],
);

export const settlements = pgTable(
  "settlements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => users.id),
    factVersionId: uuid("fact_version_id")
      .notNull()
      .references(() => factVersions.id),
    ruleVersionId: uuid("rule_version_id")
      .notNull()
      .references(() => pointRuleVersions.id),
    settlementPeriod: date("settlement_period").notNull(),
    result: text("result").notNull(),
    explanation: text("explanation").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
  },
  (table) => [
    check("settlements_result_check", sql`${table.result} IN ('reward')`),
    unique("settlements_fact_rule_period_unique").on(
      table.factVersionId,
      table.ruleVersionId,
      table.settlementPeriod,
    ),
  ],
);

export const pointLedgerEntries = pgTable(
  "point_ledger_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => users.id),
    settlementId: uuid("settlement_id")
      .notNull()
      .references(() => settlements.id),
    amount: integer("amount").notNull(),
    reason: text("reason").notNull(),
    sourceType: text("source_type").notNull(),
    explanation: text("explanation").notNull(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => settlements.id),
    reversesEntryId: uuid("reverses_entry_id").references((): AnyPgColumn => pointLedgerEntries.id),
    createdBy: uuid("created_by").references(() => users.id),
    idempotencyKey: text("idempotency_key").notNull(),
  },
  (table) => [
    unique("point_ledger_entries_settlement_id_unique").on(table.settlementId),
    check(
      "point_ledger_entries_source_check",
      sql`${table.sourceType} = 'settlement' AND ${table.sourceId} = ${table.settlementId}`,
    ),
  ],
);

export const pointBalanceProjection = pgTable("point_balance_projection", {
  studentId: uuid("student_id")
    .primaryKey()
    .references(() => users.id),
  balance: integer("balance").notNull().default(0),
  lastLedgerEntryId: uuid("last_ledger_entry_id").references(() => pointLedgerEntries.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});
