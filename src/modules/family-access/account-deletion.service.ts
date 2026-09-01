import { and, eq, isNull } from "drizzle-orm";

import type { Database } from "@/db";
import { dailyReflections, privateAccessGrants, relationships } from "@/db/schema";
import { PRIVATE_RESOURCE_TYPES } from "@/modules/reflection-privacy/constants";

export async function revokeAllAuthorizationsForStudentDeletion(
  tx: Database,
  input: { studentId: string; now: Date },
): Promise<{ relationshipsEnded: number; grantsRevoked: number }> {
  const endedRelationships = await tx
    .update(relationships)
    .set({
      status: "ended",
      endedAt: input.now,
      endedBy: input.studentId,
    })
    .where(and(eq(relationships.studentId, input.studentId), eq(relationships.status, "active")))
    .returning({ id: relationships.id });

  const reflectionRows = await tx
    .select({ id: dailyReflections.id })
    .from(dailyReflections)
    .where(eq(dailyReflections.studentId, input.studentId));

  let grantsRevoked = 0;

  for (const reflection of reflectionRows) {
    const revoked = await tx
      .update(privateAccessGrants)
      .set({ revokedAt: input.now })
      .where(
        and(
          eq(privateAccessGrants.resourceId, reflection.id),
          eq(privateAccessGrants.resourceType, PRIVATE_RESOURCE_TYPES.DAILY_REFLECTION),
          isNull(privateAccessGrants.revokedAt),
        ),
      )
      .returning({ id: privateAccessGrants.id });

    grantsRevoked += revoked.length;
  }

  return { relationshipsEnded: endedRelationships.length, grantsRevoked };
}

export async function replayRelationshipAndGrantRevocationForStudent(
  tx: Database,
  input: { studentId: string; purgedAt: Date },
): Promise<{ relationshipsEnded: number; grantsRevoked: number }> {
  const reEnded = await tx
    .update(relationships)
    .set({
      status: "ended",
      endedAt: input.purgedAt,
      endedBy: input.studentId,
    })
    .where(and(eq(relationships.studentId, input.studentId), eq(relationships.status, "active")))
    .returning({ id: relationships.id });

  const activeGrants = await tx
    .select({ id: privateAccessGrants.id })
    .from(privateAccessGrants)
    .innerJoin(dailyReflections, eq(privateAccessGrants.resourceId, dailyReflections.id))
    .where(
      and(eq(dailyReflections.studentId, input.studentId), isNull(privateAccessGrants.revokedAt)),
    );

  for (const grant of activeGrants) {
    await tx
      .update(privateAccessGrants)
      .set({ revokedAt: input.purgedAt })
      .where(eq(privateAccessGrants.id, grant.id));
  }

  return { relationshipsEnded: reEnded.length, grantsRevoked: activeGrants.length };
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

export async function countActivePrivateGrantsForStudent(
  tx: Database,
  studentId: string,
): Promise<number> {
  const rows = await tx
    .select({ id: privateAccessGrants.id })
    .from(privateAccessGrants)
    .innerJoin(dailyReflections, eq(privateAccessGrants.resourceId, dailyReflections.id))
    .where(and(eq(dailyReflections.studentId, studentId), isNull(privateAccessGrants.revokedAt)));

  return rows.length;
}
