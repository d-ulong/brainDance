import { sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { check, date, integer, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { users } from "./identity";
import { pointLedgerEntries } from "./points";

export const goals = pgTable("goals", {
  id: uuid("id").primaryKey().defaultRandom(),
  studentId: uuid("student_id")
    .notNull()
    .references(() => users.id),
  creatorId: uuid("creator_id")
    .notNull()
    .references(() => users.id),
  title: text("title").notNull(),
  status: text("status").notNull(),
  startDate: date("start_date").notNull(),
  dueDate: date("due_date"),
  closedAt: timestamp("closed_at", { withTimezone: true }),
});

export const goalDefinitions = pgTable("goal_definitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  creatorId: uuid("creator_id").notNull().references(() => users.id),
  responsibleParentId: uuid("responsible_parent_id").references(() => users.id),
  source: text("source").notNull(),
  content: text("content").notNull(),
  dueDate: date("due_date").notNull(),
  expectedPoints: integer("expected_points"),
  expectedGift: text("expected_gift"),
  notes: text("notes"),
  horizon: text("horizon").notNull().default("medium"),
  revision: integer("revision").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("goal_definitions_source_check", sql`${table.source} IN ('parent', 'student')`),
  check("goal_definitions_expected_points_check", sql`${table.expectedPoints} IS NULL OR ${table.expectedPoints} >= 0`),
  check("goal_definitions_horizon_check", sql`${table.horizon} IN ('short', 'medium', 'long')`),
]);

export const goalAssignments = pgTable("goal_assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  definitionId: uuid("definition_id").notNull().references(() => goalDefinitions.id),
  subjectId: uuid("subject_id").notNull().references(() => users.id),
  responsibleParentId: uuid("responsible_parent_id").references(() => users.id),
  status: text("status").notNull(),
  actualPoints: integer("actual_points"),
  actualGift: text("actual_gift"),
  evaluationReason: text("evaluation_reason"),
  evaluatedBy: uuid("evaluated_by").references(() => users.id),
  evaluatedAt: timestamp("evaluated_at", { withTimezone: true }),
  completedBy: uuid("completed_by").references(() => users.id),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("goal_assignments_definition_subject_unique").on(table.definitionId, table.subjectId),
  check("goal_assignments_status_check", sql`${table.status} IN ('pending_approval', 'active', 'completed', 'succeeded', 'failed')`),
  check("goal_assignments_actual_points_check", sql`${table.actualPoints} IS NULL OR ${table.actualPoints} >= 0`),
  check("goal_assignments_terminal_fields_check", sql`
    (
      (${table.completedBy} IS NULL AND ${table.completedAt} IS NULL)
      OR (${table.completedBy} IS NOT NULL AND ${table.completedAt} IS NOT NULL)
    )
    AND (
      (${table.status} IN ('pending_approval', 'active') AND ${table.evaluatedBy} IS NULL AND ${table.evaluatedAt} IS NULL AND ${table.completedBy} IS NULL AND ${table.completedAt} IS NULL)
      OR (${table.status} = 'completed' AND ${table.completedBy} IS NOT NULL AND ${table.completedAt} IS NOT NULL AND ${table.evaluatedBy} IS NULL AND ${table.evaluatedAt} IS NULL)
      OR (${table.status} IN ('succeeded', 'failed') AND ${table.evaluatedBy} IS NOT NULL AND ${table.evaluatedAt} IS NOT NULL)
    )
  `),
]);

export const goalNotes = pgTable("goal_notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  assignmentId: uuid("assignment_id").notNull().references(() => goalAssignments.id),
  authorId: uuid("author_id").notNull().references(() => users.id),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const goalCommands = pgTable("goal_commands", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorId: uuid("actor_id").notNull().references(() => users.id),
  key: text("key").notNull(),
  payloadHash: text("payload_hash").notNull(),
  result: text("result").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [unique("goal_commands_actor_key_unique").on(table.actorId, table.key)]);

export const goalGiftRedemptions = pgTable("goal_gift_redemptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  assignmentId: uuid("assignment_id")
    .notNull()
    .references(() => goalAssignments.id),
  recordedBy: uuid("recorded_by")
    .notNull()
    .references(() => users.id),
  redeemedAt: timestamp("redeemed_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("goal_gift_redemptions_assignment_id_unique").on(table.assignmentId),
]);

export const manualPointAdjustments = pgTable("manual_point_adjustments", {
  id: uuid("id").primaryKey().defaultRandom(),
  studentId: uuid("student_id").notNull().references(() => users.id),
  actorParentId: uuid("actor_parent_id").notNull().references(() => users.id),
  kind: text("kind").notNull(),
  amount: integer("amount").notNull(),
  reason: text("reason").notNull(),
  originalAdjustmentId: uuid("original_adjustment_id").references(
    (): AnyPgColumn => manualPointAdjustments.id,
  ),
  ledgerEntryId: uuid("ledger_entry_id").notNull().references(() => pointLedgerEntries.id),
  idempotencyKey: text("idempotency_key").notNull(),
  payloadHash: text("payload_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("manual_point_adjustments_actor_key_unique").on(table.actorParentId, table.idempotencyKey),
  uniqueIndex("manual_point_adjustments_one_reversal_unique")
    .on(table.originalAdjustmentId)
    .where(sql`${table.kind} = 'reversal'`),
  check("manual_point_adjustments_kind_check", sql`${table.kind} IN ('penalty', 'reversal')`),
  check("manual_point_adjustments_amount_check", sql`
    (${table.kind} = 'penalty' AND ${table.amount} < 0 AND ${table.originalAdjustmentId} IS NULL)
    OR (${table.kind} = 'reversal' AND ${table.amount} > 0 AND ${table.originalAdjustmentId} IS NOT NULL)
  `),
]);
