import { and, eq } from "drizzle-orm";

import type { Database } from "@/db";
import { relationships, users } from "@/db/schema";
import { requireActiveRelationship } from "@/modules/family-access/authorization.service";

export type LinkedStudentSummary = {
  studentId: string;
  relationshipId: string;
  displayName: string;
  username: string | null;
};

export async function listLinkedStudentsForParent(
  db: Database,
  parentId: string,
): Promise<LinkedStudentSummary[]> {
  const rows = await db
    .select({
      studentId: relationships.studentId,
      relationshipId: relationships.id,
      displayName: users.displayName,
      username: users.username,
    })
    .from(relationships)
    .innerJoin(users, eq(users.id, relationships.studentId))
    .where(and(eq(relationships.parentId, parentId), eq(relationships.status, "active")));

  return rows;
}

export async function getActiveRelationshipForParent(
  db: Database,
  parentId: string,
  studentId: string,
): Promise<{ relationshipId: string; familyId: string }> {
  return requireActiveRelationship(db, parentId, studentId);
}
