import { and, eq } from "drizzle-orm";

import type { Database } from "@/db";
import { relationships } from "@/db/schema";

export async function revokeAllRelationshipsForStudentDeletion(
  tx: Database,
  input: { studentId: string; now: Date },
): Promise<{ relationshipsEnded: number }> {
  const endedRelationships = await tx
    .update(relationships)
    .set({
      status: "ended",
      endedAt: input.now,
      endedBy: input.studentId,
    })
    .where(and(eq(relationships.studentId, input.studentId), eq(relationships.status, "active")))
    .returning({ id: relationships.id });

  return { relationshipsEnded: endedRelationships.length };
}

export async function replayRelationshipRevocationForStudent(
  tx: Database,
  input: { studentId: string; purgedAt: Date },
): Promise<{ relationshipsEnded: number }> {
  const reEnded = await tx
    .update(relationships)
    .set({
      status: "ended",
      endedAt: input.purgedAt,
      endedBy: input.studentId,
    })
    .where(and(eq(relationships.studentId, input.studentId), eq(relationships.status, "active")))
    .returning({ id: relationships.id });

  return { relationshipsEnded: reEnded.length };
}

export async function countActiveRelationshipsForStudent(
  tx: Database,
  studentId: string,
): Promise<number> {
  const rows = await tx
    .select({ id: relationships.id })
    .from(relationships)
    .where(and(eq(relationships.studentId, studentId), eq(relationships.status, "active")));

  return rows.length;
}
