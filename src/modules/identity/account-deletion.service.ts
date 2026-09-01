import { eq, sql } from "drizzle-orm";

import type { Database } from "@/db";
import { sessions, users } from "@/db/schema";

export async function purgeStudentSessionsInTx(tx: Database, studentId: string): Promise<number> {
  const result = await tx.delete(sessions).where(eq(sessions.userId, studentId)).returning({
    id: sessions.id,
  });
  return result.length;
}

export async function minimizeStudentIdentityForDeletion(
  tx: Database,
  input: { studentId: string; deletionRequestId: string; now: Date },
): Promise<void> {
  await tx
    .update(users)
    .set({
      displayName: "Deleted User",
      email: null,
      phone: null,
      username: sql`'deleted_' || ${input.deletionRequestId}::text`,
      status: "disabled",
      updatedAt: input.now,
    })
    .where(eq(users.id, input.studentId));
}

export async function replayStudentIdentityTombstone(
  tx: Database,
  input: { studentId: string; deletionRequestId: string; purgedAt: Date },
): Promise<boolean> {
  const [user] = await tx
    .select({ displayName: users.displayName })
    .from(users)
    .where(eq(users.id, input.studentId))
    .limit(1);

  if (!user || user.displayName === "Deleted User") {
    return false;
  }

  await minimizeStudentIdentityForDeletion(tx, {
    studentId: input.studentId,
    deletionRequestId: input.deletionRequestId,
    now: input.purgedAt,
  });
  await purgeStudentSessionsInTx(tx, input.studentId);
  return true;
}
