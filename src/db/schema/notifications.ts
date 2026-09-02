import { check, index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { users } from "./identity";

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recipientUserId: uuid("recipient_user_id")
      .notNull()
      .references(() => users.id),
    notificationType: text("notification_type").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: uuid("resource_id").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    dedupeKey: text("dedupe_key").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      "notifications_type_check",
      sql`${table.notificationType} IN ('family_push.published', 'family_push.answered', 'family_push.commented')`,
    ),
    unique("notifications_dedupe_key_unique").on(table.dedupeKey),
    index("notifications_recipient_created_idx").on(table.recipientUserId, table.createdAt),
  ],
);
