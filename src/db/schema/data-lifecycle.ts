import {
  check,
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

export const exportJobs = pgTable(
  "export_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requesterId: uuid("requester_id")
      .notNull()
      .references(() => users.id),
    studentId: uuid("student_id")
      .notNull()
      .references(() => users.id),
    scopeSnapshot: jsonb("scope_snapshot").notNull().$type<Record<string, unknown>>(),
    status: text("status").notNull(),
    artifactKey: text("artifact_key"),
    downloadTokenHash: text("download_token_hash"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    readyAt: timestamp("ready_at", { withTimezone: true }),
    createIdempotencyKey: text("create_idempotency_key").notNull(),
    createIdempotencyPayloadHash: text("create_idempotency_payload_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    check(
      "export_jobs_status_check",
      sql`${table.status} IN ('pending', 'processing', 'ready', 'failed', 'expired', 'revoked')`,
    ),
    unique("export_jobs_requester_create_idempotency_unique").on(
      table.requesterId,
      table.createIdempotencyKey,
    ),
    uniqueIndex("export_jobs_download_token_hash_unique")
      .on(table.downloadTokenHash)
      .where(sql`${table.downloadTokenHash} IS NOT NULL`),
  ],
);

export const deletionRequests = pgTable(
  "deletion_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => users.id),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id),
    status: text("status").notNull(),
    revocableUntil: timestamp("revocable_until", { withTimezone: true }).notNull(),
    studentConfirmedAt: timestamp("student_confirmed_at", { withTimezone: true }),
    adminForceReason: text("admin_force_reason"),
    createIdempotencyKey: text("create_idempotency_key").notNull(),
    createIdempotencyPayloadHash: text("create_idempotency_payload_hash").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    executedAt: timestamp("executed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    check(
      "deletion_requests_target_type_check",
      sql`${table.targetType} IN ('student_account', 'daily_reflection')`,
    ),
    check(
      "deletion_requests_status_check",
      sql`${table.status} IN ('requested', 'frozen', 'cancelled', 'executed')`,
    ),
    unique("deletion_requests_requester_create_idempotency_unique").on(
      table.requestedBy,
      table.createIdempotencyKey,
    ),
    uniqueIndex("deletion_requests_active_target_unique")
      .on(table.targetType, table.targetId)
      .where(sql`${table.status} IN ('requested', 'frozen')`),
  ],
);

export const deletionTombstones = pgTable(
  "deletion_tombstones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deletionRequestId: uuid("deletion_request_id")
      .notNull()
      .references(() => deletionRequests.id),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => users.id),
    tombstoneVersion: integer("tombstone_version").notNull().default(1),
    purgedAt: timestamp("purged_at", { withTimezone: true }).notNull(),
    payload: jsonb("payload").$type<Record<string, string | number | boolean | null>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    unique("deletion_tombstones_deletion_request_unique").on(table.deletionRequestId),
    unique("deletion_tombstones_target_unique").on(table.targetType, table.targetId),
  ],
);

export const deletionExecutionSteps = pgTable(
  "deletion_execution_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deletionRequestId: uuid("deletion_request_id")
      .notNull()
      .references(() => deletionRequests.id),
    stepVersion: integer("step_version").notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    unique("deletion_execution_steps_request_step_unique").on(
      table.deletionRequestId,
      table.stepVersion,
    ),
  ],
);
