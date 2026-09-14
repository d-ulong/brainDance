import { integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { users } from "./identity";
import { familyPushes } from "./family-content";

export const pushLibraryEntries = pgTable("push_library_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").notNull().references(() => users.id),
  body: text("body").notNull(),
  linkUrl: text("link_url"),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  answerDisclosureDays: integer("answer_disclosure_days"),
  revision: integer("revision").notNull().default(1),
  createKey: text("create_key").notNull(),
  createHash: text("create_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [unique("push_library_owner_create_unique").on(t.ownerId, t.createKey)]);

export const pushLibraryPublications = pgTable("push_library_publications", {
  id: uuid("id").primaryKey().defaultRandom(),
  entryId: uuid("entry_id").notNull().references(() => pushLibraryEntries.id),
  revision: integer("revision").notNull(),
  commandKey: text("command_key").notNull(),
  payloadHash: text("payload_hash").notNull(),
  tags: jsonb("tags").$type<string[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [unique("push_library_publication_command_unique").on(t.entryId, t.commandKey)]);

export const pushLibraryDeliveries = pgTable("push_library_deliveries", {
  publicationId: uuid("publication_id").notNull().references(() => pushLibraryPublications.id),
  studentId: uuid("student_id").notNull().references(() => users.id),
  pushId: uuid("push_id").primaryKey().references(() => familyPushes.id),
}, t => [unique("push_library_publication_student_unique").on(t.publicationId, t.studentId)]);
