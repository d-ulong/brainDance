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
      sql`char_length(${table.body}) <= 10000 AND (${table.linkUrl} IS NULL OR char_length(${table.linkUrl}) <= 2048)`,
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
    check("push_answer_versions_body_check", sql`char_length(${table.body}) <= 10000`),
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

export const mediaObjects = pgTable(
  "media_objects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => users.id),
    uploaderId: uuid("uploader_id")
      .notNull()
      .references(() => users.id),
    status: text("status").notNull(),
    declaredMime: text("declared_mime").notNull(),
    detectedMime: text("detected_mime"),
    contentSha256: text("content_sha256"),
    byteSize: integer("byte_size").notNull(),
    safeByteSize: integer("safe_byte_size"),
    width: integer("width"),
    height: integer("height"),
    stagingObjectKey: text("staging_object_key").notNull(),
    safeObjectKey: text("safe_object_key"),
    scanResult: text("scan_result"),
    scanErrorCategory: text("scan_error_category"),
    referenceCount: integer("reference_count").notNull().default(0),
    unreferencedAt: timestamp("unreferenced_at", { withTimezone: true }),
    purgeAfter: timestamp("purge_after", { withTimezone: true }),
    createIdempotencyKey: text("create_idempotency_key").notNull(),
    createIdempotencyPayloadHash: text("create_idempotency_payload_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    readyAt: timestamp("ready_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    purgedAt: timestamp("purged_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "media_objects_status_check",
      sql`${table.status} IN ('staging', 'processing', 'ready', 'rejected', 'revoked', 'purged')`,
    ),
    check(
      "media_objects_scan_result_check",
      sql`${table.scanResult} IS NULL OR ${table.scanResult} IN ('pending', 'clean', 'rejected', 'error')`,
    ),
    check("media_objects_reference_count_check", sql`${table.referenceCount} >= 0`),
    check(
      "media_objects_byte_size_check",
      sql`${table.byteSize} > 0 AND ${table.byteSize} <= 10485760`,
    ),
    check(
      "media_objects_ready_invariant_check",
      sql`(
        (${table.status} <> 'ready')
        OR (
          ${table.scanResult} = 'clean'
          AND ${table.safeObjectKey} IS NOT NULL
          AND ${table.detectedMime} IS NOT NULL
          AND ${table.contentSha256} IS NOT NULL
          AND ${table.readyAt} IS NOT NULL
        )
      )`,
    ),
    check(
      "media_objects_staging_processing_check",
      sql`(
        (${table.status} NOT IN ('staging', 'processing'))
        OR (${table.safeObjectKey} IS NULL AND ${table.readyAt} IS NULL)
      )`,
    ),
    check(
      "media_objects_rejected_check",
      sql`(${table.status} <> 'rejected') OR (${table.scanResult} IN ('rejected', 'error'))`,
    ),
    check(
      "media_objects_purged_check",
      sql`(
        (${table.status} = 'purged' AND ${table.purgedAt} IS NOT NULL)
        OR (${table.status} <> 'purged' AND ${table.purgedAt} IS NULL)
      )`,
    ),
    check(
      "media_objects_purge_after_check",
      sql`(
        ${table.purgeAfter} IS NULL
        OR (
          ${table.unreferencedAt} IS NOT NULL
          AND ${table.purgeAfter} = ${table.unreferencedAt} + interval '90 days'
        )
      )`,
    ),
    unique("media_objects_uploader_create_idempotency_unique").on(
      table.uploaderId,
      table.createIdempotencyKey,
    ),
    index("media_objects_status_purge_after_idx").on(table.status, table.purgeAfter),
    index("media_objects_uploader_id_idx").on(table.uploaderId),
    index("media_objects_student_id_idx").on(table.studentId),
  ],
);

export const mediaReferences = pgTable(
  "media_references",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mediaId: uuid("media_id")
      .notNull()
      .references(() => mediaObjects.id),
    resourceType: text("resource_type").notNull(),
    resourceId: uuid("resource_id").notNull(),
    purpose: text("purpose").notNull(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => users.id),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      "media_references_resource_type_check",
      sql`${table.resourceType} IN ('family_push_version', 'push_answer_version')`,
    ),
    check(
      "media_references_purpose_check",
      sql`${table.purpose} IN ('push_image', 'answer_image', 'handwriting_image')`,
    ),
    unique("media_references_resource_media_unique").on(
      table.resourceType,
      table.resourceId,
      table.mediaId,
    ),
    uniqueIndex("media_references_active_purpose_unique")
      .on(table.resourceType, table.resourceId, table.purpose)
      .where(sql`${table.revokedAt} IS NULL`),
    index("media_references_active_media_id_idx")
      .on(table.mediaId)
      .where(sql`${table.revokedAt} IS NULL`),
  ],
);

export const mediaPurgeIntents = pgTable(
  "media_purge_intents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mediaId: uuid("media_id")
      .notNull()
      .references(() => mediaObjects.id),
    status: text("status").notNull(),
    purgeAfter: timestamp("purge_after", { withTimezone: true }).notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastErrorCategory: text("last_error_category"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("media_purge_intents_media_id_unique").on(table.mediaId),
    check(
      "media_purge_intents_status_check",
      sql`${table.status} IN ('pending', 'prepared', 'completed', 'dead')`,
    ),
    check(
      "media_purge_intents_completed_check",
      sql`(${table.status} <> 'completed') OR (${table.completedAt} IS NOT NULL)`,
    ),
  ],
);

export const mediaReadCapabilities = pgTable(
  "media_read_capabilities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull(),
    mediaId: uuid("media_id")
      .notNull()
      .references(() => mediaObjects.id),
    referenceId: uuid("reference_id")
      .notNull()
      .references(() => mediaReferences.id),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id),
    studentId: uuid("student_id")
      .notNull()
      .references(() => users.id),
    authorizationEpoch: integer("authorization_epoch").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("media_read_capabilities_token_hash_unique").on(table.tokenHash),
    index("media_read_capabilities_token_hash_expires_at_idx").on(
      table.tokenHash,
      table.expiresAt,
    ),
  ],
);
