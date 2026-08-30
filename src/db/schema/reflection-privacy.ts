import {
  date,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { users } from "./identity";

export const reflectionVisibilityEnum = pgEnum("reflection_visibility", ["normal", "private"]);

export const dailyReflections = pgTable(
  "daily_reflections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => users.id),
    familyDate: date("family_date").notNull(),
    visibility: reflectionVisibilityEnum("visibility").notNull().default("normal"),
    body: text("body").notNull(),
    currentVersion: integer("current_version").notNull().default(1),
    upsertIdempotencyKey: text("upsert_idempotency_key"),
    deleteIdempotencyKey: text("delete_idempotency_key"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    bodyPurgedAt: timestamp("body_purged_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("daily_reflections_student_date_active_unique")
      .on(table.studentId, table.familyDate)
      .where(sql`${table.deletedAt} IS NULL`),
    unique("daily_reflections_upsert_idempotency_unique").on(
      table.studentId,
      table.upsertIdempotencyKey,
    ),
    uniqueIndex("daily_reflections_delete_idempotency_unique")
      .on(table.studentId, table.deleteIdempotencyKey)
      .where(sql`${table.deleteIdempotencyKey} IS NOT NULL`),
  ],
);

export const dailyReflectionVersions = pgTable(
  "daily_reflection_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reflectionId: uuid("reflection_id")
      .notNull()
      .references(() => dailyReflections.id),
    version: integer("version").notNull(),
    visibility: reflectionVisibilityEnum("visibility").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("daily_reflection_versions_reflection_version_unique").on(
      table.reflectionId,
      table.version,
    ),
  ],
);

export const privateAccessGrants = pgTable(
  "private_access_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    resourceType: text("resource_type").notNull(),
    resourceId: uuid("resource_id").notNull(),
    parentId: uuid("parent_id")
      .notNull()
      .references(() => users.id),
    grantedAt: timestamp("granted_at", { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    grantIdempotencyKey: text("grant_idempotency_key"),
    revokeIdempotencyKey: text("revoke_idempotency_key"),
  },
  (table) => [
    uniqueIndex("private_access_grants_active_unique")
      .on(table.resourceType, table.resourceId, table.parentId)
      .where(sql`${table.revokedAt} IS NULL`),
    unique("private_access_grants_grant_idempotency_unique").on(table.grantIdempotencyKey),
    uniqueIndex("private_access_grants_revoke_idempotency_unique")
      .on(table.revokeIdempotencyKey)
      .where(sql`${table.revokeIdempotencyKey} IS NOT NULL`),
  ],
);
