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
    scheduleItemId: uuid("schedule_item_id").references(() => scheduleItems.id),
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
    submittedBy: uuid("submitted_by").references(() => users.id),
    correctionReason: text("correction_reason"),
    supersedesFactVersionId: uuid("supersedes_fact_version_id").references(
      (): AnyPgColumn => factVersions.id,
    ),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
  },
  (table) => [
    check("fact_versions_source_kind_check", sql`${table.sourceKind} IN ('system', 'manual')`),
    check(
      "fact_versions_completion_kind_check",
      sql`(${table.sourceKind} = 'system' AND ${table.completionKind} IN ('on_time', 'late')) OR (${table.sourceKind} = 'manual' AND ${table.completionKind} = 'not_applicable')`,
    ),
    check(
      "fact_versions_schedule_item_binding_check",
      sql`(${table.sourceKind} IN ('system', 'manual') AND ${table.scheduleItemId} IS NOT NULL) OR (${table.sourceKind} NOT IN ('system', 'manual') AND ${table.scheduleItemId} IS NULL)`,
    ),
    check(
      "fact_versions_confirmation_pair_check",
      sql`(${table.confirmedAt} IS NULL AND ${table.confirmedBy} IS NULL) OR (${table.confirmedAt} IS NOT NULL AND ${table.confirmedBy} IS NOT NULL)`,
    ),
    check(
      "fact_versions_manual_invariants_check",
      sql`${table.sourceKind} <> 'manual' OR (${table.scheduleItemId} IS NOT NULL AND ${table.factKey} = 'schedule.error_count' AND ${table.submittedBy} IS NOT NULL AND ${table.completionKind} = 'not_applicable' AND ${table.value} ? 'error_count' AND ((${table.value}->>'error_count') ~ '^[0-9]+$'))`,
    ),
    check(
      "fact_versions_system_invariants_check",
      sql`${table.sourceKind} <> 'system' OR (${table.scheduleItemId} IS NOT NULL AND ${table.factKey} = 'schedule.completed' AND ${table.completionKind} IN ('on_time', 'late') AND ${table.confirmedAt} IS NULL AND ${table.confirmedBy} IS NULL AND ${table.submittedBy} IS NULL AND ${table.supersedesFactVersionId} IS NULL)`,
    ),
    check(
      "fact_versions_correction_reason_check",
      sql`${table.supersedesFactVersionId} IS NULL OR ${table.correctionReason} IS NOT NULL`,
    ),
    unique("fact_versions_schedule_item_idempotency_unique").on(
      table.scheduleItemId,
      table.idempotencyKey,
    ),
    uniqueIndex("fact_versions_supersedes_predecessor_unique")
      .on(table.supersedesFactVersionId)
      .where(sql`${table.supersedesFactVersionId} IS NOT NULL`),
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
    uniqueIndex("point_rules_active_student_template_unique")
      .on(table.studentId, table.templateId)
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
    check("settlements_result_check", sql`${table.result} IN ('reward', 'reversal')`),
    unique("settlements_fact_rule_period_result_unique").on(
      table.factVersionId,
      table.ruleVersionId,
      table.settlementPeriod,
      table.result,
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("point_ledger_entries_settlement_id_unique").on(table.settlementId),
    check(
      "point_ledger_entries_source_check",
      sql`(${table.sourceType} = 'settlement' AND ${table.sourceId} = ${table.settlementId} AND ${table.reversesEntryId} IS NULL AND ${table.amount} >= 0) OR (${table.sourceType} = 'reversal' AND ${table.reversesEntryId} IS NOT NULL AND ${table.amount} < 0)`,
    ),
    uniqueIndex("point_ledger_entries_reversal_unique")
      .on(table.reversesEntryId)
      .where(sql`${table.reversesEntryId} IS NOT NULL`),
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
