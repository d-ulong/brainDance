import { sql } from "drizzle-orm";
import { check, date, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { users } from "./identity";
import { plans, scheduleItems } from "./schedule";
import { pointRules, pointRuleVersions } from "./points";

export const planLibrary = pgTable("plan_library", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").notNull().references(() => users.id),
  revision: integer("revision").notNull().default(1),
  priority: integer("priority").notNull().default(0),
  definition: jsonb("definition").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const planBindings = pgTable("plan_bindings", {
  id: uuid("id").primaryKey().defaultRandom(),
  libraryId: uuid("library_id").notNull().references(() => planLibrary.id),
  studentId: uuid("student_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique("plan_bindings_library_student_unique").on(t.libraryId, t.studentId)]);

export const planActivations = pgTable("plan_activations", {
  id: uuid("id").primaryKey().defaultRandom(),
  bindingId: uuid("binding_id").notNull().references(() => planBindings.id),
  studentId: uuid("student_id").notNull().references(() => users.id),
  executionPlanId: uuid("execution_plan_id").notNull().references(() => plans.id),
  ruleId: uuid("rule_id").references(() => pointRules.id),
  effectiveFrom: date("effective_from").notNull(),
  effectiveUntil: date("effective_until"), // exclusive, null is open ended
  definition: jsonb("definition").$type<Record<string, unknown>>().notNull(),
  revision: integer("revision").notNull(),
}, (t) => [unique("plan_activations_execution_unique").on(t.executionPlanId),
  check("plan_activations_range_check", sql`${t.effectiveUntil} IS NULL OR ${t.effectiveUntil} >= ${t.effectiveFrom}`)]);

export const planItemRules = pgTable("plan_item_rules", {
  scheduleItemId: uuid("schedule_item_id").primaryKey().references(() => scheduleItems.id),
  ruleVersionId: uuid("rule_version_id").notNull().references(() => pointRuleVersions.id),
  entry: jsonb("entry").$type<Record<string, unknown>>().notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }),
});

export const planLibraryCommands = pgTable("plan_library_commands", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorId: uuid("actor_id").notNull().references(() => users.id),
  key: text("key").notNull(),
  payloadHash: text("payload_hash").notNull(),
  result: jsonb("result").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique("plan_library_commands_actor_key_unique").on(t.actorId, t.key)]);
