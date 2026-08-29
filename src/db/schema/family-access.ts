import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { userRoleEnum, users } from "./identity";

export const relationshipStatusEnum = pgEnum("relationship_status", ["active", "ended"]);

export const relationshipRequestStatusEnum = pgEnum("relationship_request_status", [
  "pending",
  "accepted",
  "rejected",
  "cancelled",
  "expired",
]);

export const families = pgTable("families", {
  id: uuid("id").primaryKey().defaultRandom(),
  timezone: text("timezone").notNull().default("Asia/Shanghai"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const relationships = pgTable(
  "relationships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id),
    parentId: uuid("parent_id")
      .notNull()
      .references(() => users.id),
    studentId: uuid("student_id")
      .notNull()
      .references(() => users.id),
    status: relationshipStatusEnum("status").notNull().default("active"),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    endedBy: uuid("ended_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("relationships_parent_id_idx").on(table.parentId),
    index("relationships_student_id_idx").on(table.studentId),
    index("relationships_family_id_idx").on(table.familyId),
    uniqueIndex("relationships_active_parent_student_unique")
      .on(table.parentId, table.studentId)
      .where(sql`${table.status} = 'active'`),
    index("relationships_family_parent_active_idx")
      .on(table.familyId, table.parentId)
      .where(sql`${table.status} = 'active'`),
    index("relationships_family_student_active_idx")
      .on(table.familyId, table.studentId)
      .where(sql`${table.status} = 'active'`),
  ],
);

export const familyMemberships = pgTable(
  "family_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    memberRole: userRoleEnum("member_role").notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull(),
    leftAt: timestamp("left_at", { withTimezone: true }),
    derivedFromRelationshipId: uuid("derived_from_relationship_id").references(
      () => relationships.id,
    ),
  },
  (table) => [
    index("family_memberships_family_user_idx").on(table.familyId, table.userId),
    index("family_memberships_user_active_idx")
      .on(table.userId)
      .where(sql`${table.leftAt} IS NULL`),
    uniqueIndex("family_memberships_active_family_user_unique")
      .on(table.familyId, table.userId)
      .where(sql`${table.leftAt} IS NULL`),
  ],
);

export const studentAssociationCodes = pgTable(
  "student_association_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => users.id),
    codeHash: text("code_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    issueIdempotencyKey: text("issue_idempotency_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("student_association_codes_code_hash_unique").on(table.codeHash),
    unique("student_association_codes_issue_idempotency_unique").on(table.issueIdempotencyKey),
    index("student_association_codes_student_id_idx").on(table.studentId),
  ],
);

export const relationshipRequests = pgTable(
  "relationship_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    initiatorId: uuid("initiator_id")
      .notNull()
      .references(() => users.id),
    parentId: uuid("parent_id")
      .notNull()
      .references(() => users.id),
    studentId: uuid("student_id")
      .notNull()
      .references(() => users.id),
    associationCodeId: uuid("association_code_id")
      .notNull()
      .references(() => studentAssociationCodes.id),
    status: relationshipRequestStatusEnum("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    createIdempotencyKey: text("create_idempotency_key"),
    respondIdempotencyKey: text("respond_idempotency_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("relationship_requests_create_idempotency_unique").on(table.createIdempotencyKey),
    unique("relationship_requests_respond_idempotency_unique").on(table.respondIdempotencyKey),
    index("relationship_requests_student_status_idx").on(table.studentId, table.status),
  ],
);
