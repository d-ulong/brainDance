import {
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { users } from "./identity";

export const trainingSessionStatusEnum = pgEnum("training_session_status", [
  "created",
  "active",
  "submitted",
  "validated",
  "completed",
  "cancelled",
  "invalid",
  "abandoned",
]);

export const trainingSessionKindEnum = pgEnum("training_session_kind", ["effective", "practice"]);

export const trainingDefinitions = pgTable(
  "training_definitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    trainingKey: text("training_key").notNull(),
    version: integer("version").notNull(),
    ageBand: text("age_band").notNull(),
    metricSchema: jsonb("metric_schema").$type<Record<string, unknown>>().notNull().default({}),
    active: integer("active").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("training_definitions_key_version_age_unique").on(
      table.trainingKey,
      table.version,
      table.ageBand,
    ),
    index("training_definitions_key_active_idx").on(table.trainingKey, table.active),
    uniqueIndex("training_definitions_active_key_age_unique")
      .on(table.trainingKey, table.ageBand)
      .where(sql`${table.active} = 1`),
  ],
);

export const trainingSessions = pgTable(
  "training_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => users.id),
    trainingKey: text("training_key").notNull(),
    definitionId: uuid("definition_id")
      .notNull()
      .references(() => trainingDefinitions.id),
    definitionVersion: integer("definition_version").notNull(),
    ageBand: text("age_band").notNull(),
    familyDate: date("family_date").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    status: trainingSessionStatusEnum("status").notNull().default("created"),
    sessionKind: trainingSessionKindEnum("session_kind"),
    startIdempotencyKey: text("start_idempotency_key"),
    submitIdempotencyKey: text("submit_idempotency_key"),
    blurAccumulatedMs: integer("blur_accumulated_ms").notNull().default(0),
    invalidReason: text("invalid_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("training_sessions_start_idempotency_scoped")
      .on(table.studentId, table.startIdempotencyKey)
      .where(sql`${table.startIdempotencyKey} is not null`),
    uniqueIndex("training_sessions_submit_idempotency_scoped")
      .on(table.studentId, table.submitIdempotencyKey)
      .where(sql`${table.submitIdempotencyKey} is not null`),
    index("training_sessions_student_key_date_idx").on(
      table.studentId,
      table.trainingKey,
      table.familyDate,
    ),
    index("training_sessions_student_status_idx").on(table.studentId, table.status),
    uniqueIndex("training_sessions_effective_daily_unique")
      .on(table.studentId, table.trainingKey, table.familyDate)
      .where(sql`${table.sessionKind} = 'effective' AND ${table.status} = 'completed'`),
  ],
);

export const trainingEvents = pgTable(
  "training_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => trainingSessions.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("training_events_session_sequence_unique").on(table.sessionId, table.sequence),
    index("training_events_session_id_idx").on(table.sessionId),
  ],
);

export const trainingMetrics = pgTable(
  "training_metrics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => trainingSessions.id, { onDelete: "cascade" }),
    metricKey: text("metric_key").notNull(),
    value: numeric("value", { precision: 18, scale: 6 }).notNull(),
    unit: text("unit").notNull(),
    isValid: integer("is_valid").notNull().default(1),
    calculationVersion: text("calculation_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("training_metrics_session_metric_unique").on(table.sessionId, table.metricKey),
    index("training_metrics_session_id_idx").on(table.sessionId),
  ],
);

export const trainingProfileProjection = pgTable(
  "training_profile_projection",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => users.id),
    trainingKey: text("training_key").notNull(),
    definitionVersion: integer("definition_version").notNull(),
    ageBand: text("age_band").notNull(),
    metricKey: text("metric_key").notNull(),
    bestValue: numeric("best_value", { precision: 18, scale: 6 }).notNull(),
    lastValue: numeric("last_value", { precision: 18, scale: 6 }).notNull(),
    windowSummary: jsonb("window_summary").$type<Record<string, unknown>>(),
    lastSourceSessionId: uuid("last_source_session_id").references(() => trainingSessions.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("training_profile_projection_unique").on(
      table.studentId,
      table.trainingKey,
      table.definitionVersion,
      table.ageBand,
      table.metricKey,
    ),
    index("training_profile_projection_student_key_idx").on(table.studentId, table.trainingKey),
  ],
);
