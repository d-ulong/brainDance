import { index, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { users } from "./identity";

export const guardianConsents = pgTable(
  "guardian_consents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => users.id),
    parentId: uuid("parent_id")
      .notNull()
      .references(() => users.id),
    consentType: text("consent_type").notNull(),
    policyVersion: text("policy_version").notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull(),
    evidence: jsonb("evidence").$type<Record<string, string | number | boolean | null>>(),
    recordIdempotencyKey: text("record_idempotency_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("guardian_consents_record_idempotency_unique").on(table.recordIdempotencyKey),
    index("guardian_consents_student_parent_idx").on(table.studentId, table.parentId),
  ],
);
