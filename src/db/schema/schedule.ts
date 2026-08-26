import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  check,
  date,
  integer,
  jsonb,
  pgTable,
  text,
  time,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { users } from "./identity";

export const plans = pgTable(
  "plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => users.id),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id),
    goalId: uuid("goal_id"),
    planKind: text("plan_kind").notNull(),
    sourcePlanId: uuid("source_plan_id").references((): AnyPgColumn => plans.id),
    status: text("status").notNull(),
    currentVersion: uuid("current_version").references((): AnyPgColumn => planVersions.id),
    title: text("title").notNull(),
    description: text("description"),
    startDate: date("start_date").notNull(),
    endDate: date("end_date"),
    createIdempotencyKey: text("create_idempotency_key").notNull(),
    createIdempotencyPayloadHash: text("create_idempotency_payload_hash").notNull(),
    deactivateIdempotencyKey: text("deactivate_idempotency_key"),
    deactivateIdempotencyPayloadHash: text("deactivate_idempotency_payload_hash"),
  },
  (table) => [
    check("plans_status_check", sql`${table.status} IN ('active', 'inactive')`),
    unique("plans_create_idempotency_unique").on(
      table.ownerId,
      table.studentId,
      table.createIdempotencyKey,
    ),
    uniqueIndex("plans_deactivate_idempotency_unique")
      .on(table.id, table.deactivateIdempotencyKey)
      .where(sql`${table.deactivateIdempotencyKey} is not null`),
    uniqueIndex("plans_active_formal_student_unique")
      .on(table.studentId)
      .where(sql`${table.status} = 'active' AND ${table.planKind} = 'formal'`),
  ],
);

export const planVersions = pgTable(
  "plan_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    scheduleRule: jsonb("schedule_rule").$type<Record<string, unknown>>().notNull(),
    effectiveFrom: date("effective_from").notNull(),
    effectiveUntil: date("effective_until"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    createIdempotencyKey: text("create_idempotency_key").notNull(),
    createIdempotencyPayloadHash: text("create_idempotency_payload_hash").notNull(),
  },
  (table) => [
    unique("plan_versions_plan_create_idempotency_unique").on(
      table.planId,
      table.createIdempotencyKey,
    ),
    unique("plan_versions_plan_version_unique").on(table.planId, table.version),
  ],
);

export const planScheduleSlots = pgTable(
  "plan_schedule_slots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planVersionId: uuid("plan_version_id")
      .notNull()
      .references(() => planVersions.id),
    slotKey: text("slot_key").notNull(),
    localTime: time("local_time").notNull(),
  },
  (table) => [unique("plan_schedule_slots_version_slot_unique").on(table.planVersionId, table.slotKey)],
);

export const scheduleItems = pgTable(
  "schedule_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id),
    planVersionId: uuid("plan_version_id")
      .notNull()
      .references(() => planVersions.id),
    studentId: uuid("student_id")
      .notNull()
      .references(() => users.id),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id),
    familyDate: date("family_date").notNull(),
    slotKey: text("slot_key").notNull(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    status: text("status").notNull(),
    source: text("source").notNull().default("plan"),
    occurrenceKey: text("occurrence_key").notNull(),
    planSnapshot: jsonb("plan_snapshot").$type<Record<string, unknown>>(),
  },
  (table) => [
    check(
      "schedule_items_status_check",
      sql`${table.status} IN ('pending', 'completed', 'skipped', 'expired', 'cancelled')`,
    ),
    unique("schedule_items_occurrence_key_unique").on(table.occurrenceKey),
  ],
);

export const scheduleEvents = pgTable(
  "schedule_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scheduleItemId: uuid("schedule_item_id")
      .notNull()
      .references(() => scheduleItems.id),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id),
    fromStatus: text("from_status").notNull(),
    toStatus: text("to_status").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    idempotencyPayloadHash: text("idempotency_payload_hash").notNull(),
    completionKind: text("completion_kind"),
    reason: text("reason"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    unique("schedule_events_item_idempotency_unique").on(table.scheduleItemId, table.idempotencyKey),
    check("schedule_events_from_status_check", sql`${table.fromStatus} IN ('pending')`),
    check("schedule_events_to_status_check", sql`${table.toStatus} IN ('completed', 'skipped')`),
    check(
      "schedule_events_completion_reason_check",
      sql`(${table.toStatus} = 'completed' AND ${table.completionKind} IN ('on_time', 'late') AND ${table.reason} IS NULL) OR (${table.toStatus} = 'skipped' AND ${table.completionKind} IS NULL)`,
    ),
  ],
);

export const scheduleHorizonMaintains = pgTable(
  "schedule_horizon_maintains",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => users.id),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id),
    idempotencyKey: text("idempotency_key").notNull(),
    idempotencyPayloadHash: text("idempotency_payload_hash").notNull(),
    itemsCreated: integer("items_created").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    unique("schedule_horizon_maintains_student_actor_idempotency_unique").on(
      table.studentId,
      table.actorId,
      table.idempotencyKey,
    ),
  ],
);
