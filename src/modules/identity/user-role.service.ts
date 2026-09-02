import { and, eq, ne, sql } from "drizzle-orm";

import type { Database } from "@/db";
import { users } from "@/db/schema";
import { IdentityError } from "@/modules/identity/errors";

export type ParentOrStudentRole = "parent" | "student";

/** Resolve non-admin parent/student role without exposing Identity tables to callers. */
export async function getParentOrStudentRole(
  db: Database,
  userId: string,
): Promise<ParentOrStudentRole> {
  const [user] = await db
    .select({ role: users.role })
    .from(users)
    .where(and(eq(users.id, userId), ne(users.role, "admin")))
    .limit(1);
  if (!user || (user.role !== "parent" && user.role !== "student")) {
    throw new IdentityError("FORBIDDEN", "Access denied");
  }
  return user.role;
}

/** Serialize concurrent writes that need a stable per-user lock row. */
export async function lockUserRowForUpdate(db: Database, userId: string): Promise<void> {
  await db.execute(sql`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`);
}
