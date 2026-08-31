import type { Database } from "@/db";
import type { users } from "@/db/schema";
import { assertStudentAccountNotFrozen } from "@/modules/data-lifecycle/freeze-guard.service";
import { requireActiveRelationship } from "@/modules/family-access/authorization.service";
import { FamilyAccessError } from "@/modules/family-access/errors";

type DbUser = typeof users.$inferSelect;

export async function requireStudentReadAccess(
  db: Database,
  dbUser: DbUser,
  studentId: string,
): Promise<void> {
  if (dbUser.role === "student") {
    if (dbUser.id !== studentId) {
      throw new FamilyAccessError("FORBIDDEN", "Student access denied");
    }
    await assertStudentAccountNotFrozen(db, studentId);
    return;
  }

  if (dbUser.role === "parent") {
    await requireActiveRelationship(db, dbUser.id, studentId);
    await assertStudentAccountNotFrozen(db, studentId);
    return;
  }

  throw new FamilyAccessError("FORBIDDEN", "Access denied");
}
