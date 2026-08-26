import { date, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { users } from "./identity";

export const goals = pgTable("goals", {
  id: uuid("id").primaryKey().defaultRandom(),
  studentId: uuid("student_id")
    .notNull()
    .references(() => users.id),
  creatorId: uuid("creator_id")
    .notNull()
    .references(() => users.id),
  title: text("title").notNull(),
  status: text("status").notNull(),
  startDate: date("start_date").notNull(),
  dueDate: date("due_date"),
  closedAt: timestamp("closed_at", { withTimezone: true }),
});
