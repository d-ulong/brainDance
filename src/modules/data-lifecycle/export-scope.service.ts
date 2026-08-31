import { and, eq, isNull } from "drizzle-orm";

import type { Database } from "@/db";
import { privateAccessGrants, relationships, users } from "@/db/schema";
import { requireActiveRelationship } from "@/modules/family-access/authorization.service";
import { FamilyAccessError } from "@/modules/family-access/errors";
import {
  EXPORT_SCOPE_SCHEMA_VERSION,
  EXPORT_SECTIONS,
  type ExportScopeSnapshot,
} from "@/modules/data-lifecycle/constants";
import { DataLifecycleError } from "@/modules/data-lifecycle/errors";
import { assertStudentAccountNotFrozen } from "@/modules/data-lifecycle/freeze-guard.service";
import { PRIVATE_RESOURCE_TYPES } from "@/modules/reflection-privacy/constants";

export type BuildExportScopeInput = {
  requesterId: string;
  requesterRole: "student" | "parent";
  studentId: string;
};

export async function buildExportScopeSnapshot(
  db: Database,
  input: BuildExportScopeInput,
): Promise<ExportScopeSnapshot> {
  await assertStudentAccountNotFrozen(db, input.studentId);

  const [student] = await db
    .select({
      id: users.id,
      authorizationEpoch: users.authorizationEpoch,
    })
    .from(users)
    .where(eq(users.id, input.studentId))
    .limit(1);

  if (!student) {
    throw new DataLifecycleError("NOT_FOUND", "Student not found");
  }

  if (input.requesterRole === "student") {
    if (input.requesterId !== input.studentId) {
      throw new DataLifecycleError("FORBIDDEN", "Student export scope denied");
    }

    return {
      schemaVersion: EXPORT_SCOPE_SCHEMA_VERSION,
      requesterRole: "student",
      studentId: input.studentId,
      authorizationEpoch: student.authorizationEpoch,
      relationshipIds: [],
      privateGrantIds: [],
      includedSections: [...EXPORT_SECTIONS],
    };
  }

  await requireActiveRelationship(db, input.requesterId, input.studentId);

  const activeRelationships = await db
    .select({ id: relationships.id })
    .from(relationships)
    .where(
      and(
        eq(relationships.parentId, input.requesterId),
        eq(relationships.studentId, input.studentId),
        eq(relationships.status, "active"),
      ),
    );

  if (activeRelationships.length === 0) {
    throw new FamilyAccessError("FORBIDDEN", "Parent relationship required for export");
  }

  const grants = await db
    .select({ id: privateAccessGrants.id })
    .from(privateAccessGrants)
    .where(
      and(
        eq(privateAccessGrants.parentId, input.requesterId),
        eq(privateAccessGrants.resourceType, PRIVATE_RESOURCE_TYPES.DAILY_REFLECTION),
        isNull(privateAccessGrants.revokedAt),
      ),
    );

  return {
    schemaVersion: EXPORT_SCOPE_SCHEMA_VERSION,
    requesterRole: "parent",
    studentId: input.studentId,
    authorizationEpoch: student.authorizationEpoch,
    relationshipIds: activeRelationships.map((row) => row.id),
    privateGrantIds: grants.map((row) => row.id),
    includedSections: [
      "profile",
      "schedule",
      "ledger",
      "training_summary",
      "reflections",
      "redemptions",
    ],
  };
}

export function scopeSnapshotContainsBody(scope: ExportScopeSnapshot): boolean {
  return JSON.stringify(scope).includes("body");
}

export async function validateExportScopeStillAuthorized(
  db: Database,
  scope: ExportScopeSnapshot,
  requesterId: string,
): Promise<void> {
  await assertStudentAccountNotFrozen(db, scope.studentId);

  const [student] = await db
    .select({ authorizationEpoch: users.authorizationEpoch })
    .from(users)
    .where(eq(users.id, scope.studentId))
    .limit(1);

  if (!student) {
    throw new DataLifecycleError("NOT_FOUND", "Student not found");
  }

  if (student.authorizationEpoch !== scope.authorizationEpoch) {
    throw new DataLifecycleError(
      "FORBIDDEN",
      "Authorization epoch changed since export scope snapshot",
    );
  }

  if (scope.requesterRole === "parent") {
    await requireActiveRelationship(db, requesterId, scope.studentId);

    for (const grantId of scope.privateGrantIds) {
      const [grant] = await db
        .select()
        .from(privateAccessGrants)
        .where(and(eq(privateAccessGrants.id, grantId), isNull(privateAccessGrants.revokedAt)))
        .limit(1);

      if (!grant) {
        // grant revoked — parent export must exclude that reflection at generation time
        continue;
      }
    }
  }
}
