import { and, eq, isNull } from "drizzle-orm";

import type { Database } from "@/db";
import {
  auditEvents,
  dailyReflections,
  privateAccessGrants,
  relationships,
  users,
} from "@/db/schema";
import { PRIVATE_RESOURCE_TYPES } from "@/modules/reflection-privacy/constants";
import { ReflectionPrivacyError } from "@/modules/reflection-privacy/errors";
import { assertStudentAccountNotFrozen } from "@/modules/data-lifecycle/freeze-guard.service";
import { assertParentCanReadReflection } from "@/modules/reflection-privacy/read-access.service";
import { toFamilyDate } from "@/modules/time-policy/to-family-date";

export type GetDailyReflectionInput = {
  actorId: string;
  actorRole: "student" | "parent";
  studentId: string;
  familyDate: string;
};

export type DailyReflectionDto = {
  reflectionId: string;
  studentId: string;
  familyDate: string;
  visibility: "normal" | "private";
  body: string;
  currentVersion: number;
  updatedAt: string;
};

export type ReflectionGrantDto = {
  parentId: string;
  displayName: string;
  grantedAt: string;
};

export async function getDailyReflection(
  db: Database,
  input: GetDailyReflectionInput,
): Promise<DailyReflectionDto> {
  await assertStudentAccountNotFrozen(db, input.studentId, "read");

  const [reflection] = await db
    .select()
    .from(dailyReflections)
    .where(
      and(
        eq(dailyReflections.studentId, input.studentId),
        eq(dailyReflections.familyDate, input.familyDate),
        isNull(dailyReflections.deletedAt),
      ),
    )
    .limit(1);

  if (!reflection) {
    throw new ReflectionPrivacyError("NOT_FOUND", "Daily reflection not found");
  }

  if (input.actorRole === "student") {
    if (input.actorId !== input.studentId) {
      throw new ReflectionPrivacyError("FORBIDDEN", "Student access denied");
    }
  } else {
    await assertParentCanReadReflection(db, input.actorId, reflection);
  }

  return toDto(reflection);
}

export async function listReflectionGrants(
  db: Database,
  input: { studentId: string; familyDate: string },
): Promise<{ grants: ReflectionGrantDto[] }> {
  const [reflection] = await db
    .select()
    .from(dailyReflections)
    .where(
      and(
        eq(dailyReflections.studentId, input.studentId),
        eq(dailyReflections.familyDate, input.familyDate),
        isNull(dailyReflections.deletedAt),
      ),
    )
    .limit(1);

  if (!reflection) {
    throw new ReflectionPrivacyError("NOT_FOUND", "Daily reflection not found");
  }

  if (reflection.visibility !== "private") {
    return { grants: [] };
  }

  const rows = await db
    .select({
      parentId: users.id,
      displayName: users.displayName,
      grantedAt: privateAccessGrants.grantedAt,
    })
    .from(privateAccessGrants)
    .innerJoin(users, eq(users.id, privateAccessGrants.parentId))
    .where(
      and(
        eq(privateAccessGrants.resourceType, PRIVATE_RESOURCE_TYPES.DAILY_REFLECTION),
        eq(privateAccessGrants.resourceId, reflection.id),
        isNull(privateAccessGrants.revokedAt),
      ),
    );

  return {
    grants: rows.map((row) => ({
      parentId: row.parentId,
      displayName: row.displayName,
      grantedAt: row.grantedAt.toISOString(),
    })),
  };
}

export async function listActiveParentsForStudent(
  db: Database,
  studentId: string,
): Promise<Array<{ parentId: string; displayName: string }>> {
  const rows = await db
    .select({
      parentId: users.id,
      displayName: users.displayName,
    })
    .from(users)
    .innerJoin(
      relationships,
      and(
        eq(relationships.parentId, users.id),
        eq(relationships.studentId, studentId),
        eq(relationships.status, "active"),
      ),
    );

  return rows;
}

export function assertEditableFamilyDate(familyDate: string, now: Date = new Date()): void {
  if (familyDate !== toFamilyDate(now)) {
    throw new ReflectionPrivacyError(
      "REFLECTION_NOT_TODAY",
      "Only today's reflection can be edited",
    );
  }
}

export async function findReflectionByStudentDate(
  db: Database,
  studentId: string,
  familyDate: string,
) {
  const [reflection] = await db
    .select()
    .from(dailyReflections)
    .where(
      and(
        eq(dailyReflections.studentId, studentId),
        eq(dailyReflections.familyDate, familyDate),
        isNull(dailyReflections.deletedAt),
      ),
    )
    .limit(1);

  return reflection ?? null;
}

export async function findReflectionReplayByAudit(
  db: Database,
  idempotencyKey: string,
  expectedAction: string,
): Promise<string | null> {
  const auditKey = `audit:${expectedAction}:${idempotencyKey}`;
  const [existing] = await db
    .select({ resourceId: auditEvents.resourceId })
    .from(auditEvents)
    .where(eq(auditEvents.idempotencyKey, auditKey))
    .limit(1);

  return existing?.resourceId ?? null;
}

function toDto(reflection: typeof dailyReflections.$inferSelect): DailyReflectionDto {
  return {
    reflectionId: reflection.id,
    studentId: reflection.studentId,
    familyDate: reflection.familyDate,
    visibility: reflection.visibility,
    body: reflection.body,
    currentVersion: reflection.currentVersion,
    updatedAt: reflection.updatedAt.toISOString(),
  };
}
