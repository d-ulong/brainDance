import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", ["admin", "parent", "student"]);

export const userStatusEnum = pgEnum("user_status", [
  "pending_verification",
  "active",
  "locked",
  "disabled",
]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    role: userRoleEnum("role").notNull(),
    displayName: text("display_name").notNull(),
    email: text("email"),
    phone: text("phone"),
    username: text("username"),
    birthDate: date("birth_date"),
    passwordHash: text("password_hash").notNull(),
    contactVerifiedAt: timestamp("contact_verified_at", { withTimezone: true }),
    status: userStatusEnum("status").notNull().default("pending_verification"),
    authorizationEpoch: integer("authorization_epoch").notNull().default(0),
    mustChangePassword: boolean("must_change_password").notNull().default(false),
    passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("users_email_unique").on(table.email),
    unique("users_phone_unique").on(table.phone),
    unique("users_username_unique").on(table.username),
  ],
);

export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    codeHash: text("code_hash").notNull(),
    targetRole: userRoleEnum("target_role").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    maxUses: integer("max_uses").notNull().default(1),
    usedCount: integer("used_count").notNull().default(0),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdById: uuid("created_by_id")
      .notNull()
      .references(() => users.id),
    creationIdempotencyKey: text("creation_idempotency_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("invitations_code_hash_unique").on(table.codeHash),
    unique("invitations_creation_idempotency_key_unique").on(table.creationIdempotencyKey),
    index("invitations_target_role_idx").on(table.targetRole),
  ],
);

export const invitationRedemptions = pgTable(
  "invitation_redemptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    invitationId: uuid("invitation_id")
      .notNull()
      .references(() => invitations.id),
    userId: uuid("user_id").references(() => users.id),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("invitation_redemptions_invitation_idempotency_unique").on(
      table.invitationId,
      table.idempotencyKey,
    ),
  ],
);

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  authorizationEpoch: integer("authorization_epoch").notNull().default(0),
});

export const contactVerificationCodes = pgTable(
  "contact_verification_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    contactType: text("contact_type").notNull(),
    contactValue: text("contact_value").notNull(),
    codeHash: text("code_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    issueIdempotencyKey: text("issue_idempotency_key"),
    verifyIdempotencyKey: text("verify_idempotency_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("contact_verification_issue_idempotency_unique").on(table.issueIdempotencyKey),
    unique("contact_verification_verify_idempotency_unique").on(table.verifyIdempotencyKey),
  ],
);

export const loginSecurityEvents = pgTable(
  "login_security_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountKey: text("account_key").notNull(),
    eventType: text("event_type").notNull(),
    ipAddress: text("ip_address"),
    idempotencyKey: text("idempotency_key"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("login_security_events_account_key_idx").on(table.accountKey),
    unique("login_security_events_idempotency_unique").on(table.idempotencyKey),
  ],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id"),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: uuid("resource_id"),
    reasonCode: text("reason_code"),
    requestId: text("request_id"),
    idempotencyKey: text("idempotency_key"),
    metadata: jsonb("metadata").$type<Record<string, string | number | boolean | null>>(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [unique("audit_events_idempotency_unique").on(table.idempotencyKey)],
);
