import {
  check,
  index,
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

export const familyPushes = pgTable(
  "family_pushes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => users.id),
    creatorParentId: uuid("creator_parent_id")
      .notNull()
      .references(() => users.id),
    status: text("status").notNull(),
    currentVersion: integer("current_version").notNull().default(1),
    scheduledPublishAt: timestamp("scheduled_publish_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createIdempotencyKey: text("create_idempotency_key").notNull(),
    createIdempotencyPayloadHash: text("create_idempotency_payload_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      "family_pushes_status_check",
      sql`${table.status} IN ('draft', 'scheduled', 'published', 'disabled', 'deleted', 'cancelled')`,
    ),
    check("family_pushes_current_version_positive_check", sql`${table.currentVersion} > 0`),
    check(
      "family_pushes_state_invariants_check",
      sql`(
        (${table.status} = 'draft' AND ${table.scheduledPublishAt} IS NULL AND ${table.publishedAt} IS NULL)
        OR (${table.status} = 'scheduled' AND ${table.scheduledPublishAt} IS NOT NULL AND ${table.publishedAt} IS NULL)
        OR (${table.status} = 'published' AND ${table.publishedAt} IS NOT NULL)
        OR (${table.status} = 'disabled' AND ${table.publishedAt} IS NOT NULL)
        OR (${table.status} = 'deleted')
        OR (${table.status} = 'cancelled' AND ${table.publishedAt} IS NULL)
      )`,
    ),
    unique("family_pushes_creator_create_idempotency_unique").on(
      table.creatorParentId,
      table.createIdempotencyKey,
    ),
    index("family_pushes_student_status_idx").on(table.studentId, table.status, table.updatedAt),
    index("family_pushes_creator_status_idx").on(table.creatorParentId, table.status),
  ],
);

export const familyPushVersions = pgTable(
  "family_push_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pushId: uuid("push_id")
      .notNull()
      .references(() => familyPushes.id),
    version: integer("version").notNull(),
    body: text("body").notNull(),
    linkUrl: text("link_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("family_push_versions_version_positive_check", sql`${table.version} > 0`),
    check(
      "family_push_versions_content_check",
      sql`length(trim(${table.body})) > 0 OR (${table.linkUrl} IS NOT NULL AND length(trim(${table.linkUrl})) > 0)`,
    ),
    unique("family_push_versions_push_version_unique").on(table.pushId, table.version),
  ],
);

export const pushAnswers = pgTable(
  "push_answers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pushId: uuid("push_id")
      .notNull()
      .references(() => familyPushes.id),
    studentId: uuid("student_id")
      .notNull()
      .references(() => users.id),
    currentVersion: integer("current_version").notNull().default(1),
    createIdempotencyKey: text("create_idempotency_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("push_answers_current_version_positive_check", sql`${table.currentVersion} > 0`),
    unique("push_answers_push_unique").on(table.pushId),
    unique("push_answers_push_student_unique").on(table.pushId, table.studentId),
  ],
);

export const pushAnswerVersions = pgTable(
  "push_answer_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    answerId: uuid("answer_id")
      .notNull()
      .references(() => pushAnswers.id),
    version: integer("version").notNull(),
    body: text("body").notNull(),
    submitIdempotencyKey: text("submit_idempotency_key").notNull(),
    submitIdempotencyPayloadHash: text("submit_idempotency_payload_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("push_answer_versions_version_positive_check", sql`${table.version} > 0`),
    check("push_answer_versions_body_check", sql`length(trim(${table.body})) > 0`),
    unique("push_answer_versions_answer_version_unique").on(table.answerId, table.version),
    unique("push_answer_versions_answer_submit_idempotency_unique").on(
      table.answerId,
      table.submitIdempotencyKey,
    ),
  ],
);

export const pushComments = pgTable(
  "push_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pushId: uuid("push_id")
      .notNull()
      .references(() => familyPushes.id),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id),
    parentCommentId: uuid("parent_comment_id"),
    currentVersion: integer("current_version").notNull().default(1),
    createIdempotencyKey: text("create_idempotency_key").notNull(),
    createIdempotencyPayloadHash: text("create_idempotency_payload_hash").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("push_comments_current_version_positive_check", sql`${table.currentVersion} > 0`),
    unique("push_comments_author_create_idempotency_unique").on(
      table.authorId,
      table.createIdempotencyKey,
    ),
    index("push_comments_push_created_idx").on(table.pushId, table.createdAt),
  ],
);

export const pushCommentVersions = pgTable(
  "push_comment_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    commentId: uuid("comment_id")
      .notNull()
      .references(() => pushComments.id),
    version: integer("version").notNull(),
    body: text("body").notNull(),
    mutateIdempotencyKey: text("mutate_idempotency_key"),
    mutateIdempotencyPayloadHash: text("mutate_idempotency_payload_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("push_comment_versions_version_positive_check", sql`${table.version} > 0`),
    check("push_comment_versions_body_check", sql`length(trim(${table.body})) > 0`),
    unique("push_comment_versions_comment_version_unique").on(table.commentId, table.version),
    uniqueIndex("push_comment_versions_mutate_idempotency_unique")
      .on(table.mutateIdempotencyKey)
      .where(sql`${table.mutateIdempotencyKey} IS NOT NULL`),
  ],
);
