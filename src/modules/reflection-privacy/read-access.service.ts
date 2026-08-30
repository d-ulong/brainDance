import { and, eq, isNull } from "drizzle-orm";

import type { Database } from "@/db";
import { dailyReflections, privateAccessGrants } from "@/db/schema";
import { hasActiveRelationship } from "@/modules/family-access/authorization.service";
import { PRIVATE_RESOURCE_TYPES } from "@/modules/reflection-privacy/constants";
import { ReflectionPrivacyError } from "@/modules/reflection-privacy/errors";

type ReflectionRow = typeof dailyReflections.$inferSelect;

export async function hasActivePrivateGrant(
  db: Database,
  reflectionId: string,
  parentId: string,
): Promise<boolean> {
  const [grant] = await db
    .select({ id: privateAccessGrants.id })
    .from(privateAccessGrants)
    .where(
      and(
        eq(privateAccessGrants.resourceType, PRIVATE_RESOURCE_TYPES.DAILY_REFLECTION),
        eq(privateAccessGrants.resourceId, reflectionId),
        eq(privateAccessGrants.parentId, parentId),
        isNull(privateAccessGrants.revokedAt),
      ),
    )
    .limit(1);

  return Boolean(grant);
}

export async function assertParentCanReadReflection(
  db: Database,
  parentId: string,
  reflection: ReflectionRow,
): Promise<void> {
  const active = await hasActiveRelationship(db, parentId, reflection.studentId);
  if (!active) {
    throw new ReflectionPrivacyError("FORBIDDEN", "No active relationship for this student");
  }

  if (reflection.visibility === "normal") {
    return;
  }

  const granted = await hasActivePrivateGrant(db, reflection.id, parentId);
  if (!granted) {
    throw new ReflectionPrivacyError("FORBIDDEN", "Private reflection access not granted");
  }
}

export async function assertStudentOwnsReflection(
  studentId: string,
  reflection: ReflectionRow,
): Promise<void> {
  if (reflection.studentId !== studentId) {
    throw new ReflectionPrivacyError("FORBIDDEN", "Student access denied");
  }
}

export function assertReflectionNotDeleted(reflection: ReflectionRow): void {
  if (reflection.deletedAt) {
    throw new ReflectionPrivacyError("REFLECTION_DELETED", "Reflection has been deleted");
  }
}
