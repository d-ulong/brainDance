import { eq, sql } from "drizzle-orm";

import type { Database } from "@/db";
import { users } from "@/db/schema";
import { DataLifecycleError } from "@/modules/data-lifecycle/errors";
import { assertStudentAccountNotFrozen } from "@/modules/data-lifecycle/freeze-guard.service";
import { ageInYearsAt } from "@/modules/time-policy/resolve-age-band";

/** Call with the transaction handle for commands, in addition to resource authorization. */
export async function assertSubjectAccess(
  db: Database,
  subjectId: string,
  mode: "read" | "write",
  now = new Date(),
): Promise<void> {
  if (mode === "write")
    await db.execute(sql`SELECT id FROM users WHERE id = ${subjectId}::uuid FOR UPDATE`);
  const [subject] = await db.select().from(users).where(eq(users.id, subjectId)).limit(1);
  if (!subject || subject.status === "disabled") {
    throw new DataLifecycleError("FORBIDDEN", "该账号当前不可访问");
  }
  if (subject.role !== "student") return;
  await assertStudentAccountNotFrozen(db, subjectId, mode);
  if (
    mode === "write" &&
    (!subject.birthDate || ageInYearsAt(new Date(`${subject.birthDate}T00:00:00+08:00`), now) >= 19)
  ) {
    throw new DataLifecycleError("FORBIDDEN", "学生年满 19 岁后仅可查看历史记录");
  }
}
