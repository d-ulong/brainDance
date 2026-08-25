import { and, eq } from "drizzle-orm";

import type { Database } from "@/db";
import { relationships } from "@/db/schema";
import { FamilyAccessError } from "@/modules/family-access/errors";

export async function hasActiveRelationship(
  db: Database,
  parentId: string,
  studentId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: relationships.id })
    .from(relationships)
    .where(
      and(
        eq(relationships.parentId, parentId),
        eq(relationships.studentId, studentId),
        eq(relationships.status, "active"),
      ),
    )
    .limit(1);

  return Boolean(row);
}

export async function requireActiveRelationship(
  db: Database,
  parentId: string,
  studentId: string,
): Promise<{ relationshipId: string; familyId: string }> {
  const [row] = await db
    .select({
      id: relationships.id,
      familyId: relationships.familyId,
    })
    .from(relationships)
    .where(
      and(
        eq(relationships.parentId, parentId),
        eq(relationships.studentId, studentId),
        eq(relationships.status, "active"),
      ),
    )
    .limit(1);

  if (!row) {
    throw new FamilyAccessError("FORBIDDEN", "No active relationship for this student");
  }

  return { relationshipId: row.id, familyId: row.familyId };
}

export async function getActiveStudentFamilyId(
  db: Database,
  studentId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ familyId: relationships.familyId })
    .from(relationships)
    .where(and(eq(relationships.studentId, studentId), eq(relationships.status, "active")))
    .limit(1);

  return row?.familyId ?? null;
}

export async function assertNoActiveRelationshipPair(
  db: Database,
  parentId: string,
  studentId: string,
): Promise<void> {
  if (await hasActiveRelationship(db, parentId, studentId)) {
    throw new FamilyAccessError("RELATIONSHIP_ALREADY_ACTIVE", "Relationship already active");
  }
}

export async function countActiveRelationshipsForStudent(
  db: Database,
  studentId: string,
): Promise<number> {
  const rows = await db
    .select({ id: relationships.id })
    .from(relationships)
    .where(and(eq(relationships.studentId, studentId), eq(relationships.status, "active")));

  return rows.length;
}
