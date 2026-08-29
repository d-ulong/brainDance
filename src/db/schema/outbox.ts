import {
  check,
  index,
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

export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    eventType: text("event_type").notNull(),
    eventVersion: integer("event_version").notNull().default(1),
    dedupeKey: text("dedupe_key").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status").notNull().default("pending"),
    availableAt: timestamp("available_at", { withTimezone: true }).defaultNow().notNull(),
    leasedUntil: timestamp("leased_until", { withTimezone: true }),
    leaseToken: uuid("lease_token"),
    leaseOwner: text("lease_owner"),
    attempts: integer("attempts").notNull().default(0),
    lastErrorCode: text("last_error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("outbox_events_dedupe_key_unique").on(table.dedupeKey),
    check(
      "outbox_events_status_check",
      sql`${table.status} IN ('pending', 'leased', 'processed', 'dead')`,
    ),
    check(
      "outbox_events_lease_fields_check",
      sql`${table.status} <> 'leased' OR (${table.leasedUntil} IS NOT NULL AND ${table.leaseToken} IS NOT NULL AND ${table.leaseOwner} IS NOT NULL)`,
    ),
    index("outbox_events_claim_eligible_idx")
      .on(table.availableAt)
      .where(sql`${table.status} IN ('pending', 'leased')`),
    index("outbox_events_dead_list_idx")
      .on(table.createdAt)
      .where(sql`${table.status} = 'dead'`),
  ],
);

export const workerAttempts = pgTable(
  "worker_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outboxEventId: uuid("outbox_event_id")
      .notNull()
      .references(() => outboxEvents.id),
    attemptNumber: integer("attempt_number").notNull(),
    outcome: text("outcome").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    errorCategory: text("error_category"),
    replayActorId: uuid("replay_actor_id").references(() => users.id),
    replayReason: text("replay_reason"),
    leaseToken: uuid("lease_token"),
  },
  (table) => [
    unique("worker_attempts_outbox_attempt_unique").on(table.outboxEventId, table.attemptNumber),
    check(
      "worker_attempts_outcome_check",
      sql`${table.outcome} IN ('success', 'failure', 'leased', 'replayed')`,
    ),
    index("worker_attempts_outbox_event_idx").on(table.outboxEventId),
  ],
);
