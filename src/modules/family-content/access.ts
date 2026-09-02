import { and, eq, ne } from "drizzle-orm";

import type { Database } from "@/db";
import { familyPushes, relationships, users } from "@/db/schema";
import { assertStudentAccountNotFrozen } from "@/modules/data-lifecycle/freeze-guard.service";
import { DataLifecycleError } from "@/modules/data-lifecycle/errors";
import {
  hasActiveRelationship,
  requireActiveRelationship,
} from "@/modules/family-access/authorization.service";
import {
  READABLE_STATUSES_FOR_FAMILY,
  STUDENT_READABLE_STATUSES,
  type FamilyPushStatus,
} from "@/modules/family-content/constants";
import { FamilyContentError } from "@/modules/family-content/errors";

export type FamilyContentActor = {
  actorId: string;
  actorRole: "parent" | "student";
};

export async function assertStudentNotFrozenForFamilyContent(
  db: Database,
  studentId: string,
  mode: "read" | "write" = "read",
): Promise<void> {
  try {
    await assertStudentAccountNotFrozen(db, studentId, mode);
  } catch (error) {
    if (error instanceof DataLifecycleError && error.code === "FROZEN") {
      throw new FamilyContentError("FROZEN", "Student account is frozen");
    }
    throw error;
  }
}

export async function requireParentLinkedToStudent(
  db: Database,
  parentId: string,
  studentId: string,
): Promise<{ relationshipId: string; familyId: string }> {
  try {
    return await requireActiveRelationship(db, parentId, studentId);
  } catch {
    throw new FamilyContentError("FORBIDDEN", "Access denied");
  }
}

export async function assertCanAccessPush(
  db: Database,
  input: FamilyContentActor & { push: typeof familyPushes.$inferSelect },
): Promise<"creator" | "linked_parent" | "target_student"> {
  await assertStudentNotFrozenForFamilyContent(db, input.push.studentId, "read");

  if (input.push.status === "deleted" || input.push.status === "cancelled") {
    throw new FamilyContentError("NOT_FOUND", "Push not found");
  }

  if (input.actorRole === "student") {
    if (input.actorId !== input.push.studentId) {
      throw new FamilyContentError("FORBIDDEN", "Access denied");
    }
    if (!STUDENT_READABLE_STATUSES.has(input.push.status as FamilyPushStatus)) {
      throw new FamilyContentError("NOT_FOUND", "Push not found");
    }
    return "target_student";
  }

  if (input.actorId === input.push.creatorParentId) {
    if (!(await hasActiveRelationship(db, input.actorId, input.push.studentId))) {
      throw new FamilyContentError("FORBIDDEN", "Access denied");
    }
    if (!READABLE_STATUSES_FOR_FAMILY.has(input.push.status as FamilyPushStatus)) {
      throw new FamilyContentError("NOT_FOUND", "Push not found");
    }
    return "creator";
  }

  if (!(await hasActiveRelationship(db, input.actorId, input.push.studentId))) {
    throw new FamilyContentError("FORBIDDEN", "Access denied");
  }
  if (!READABLE_STATUSES_FOR_FAMILY.has(input.push.status as FamilyPushStatus)) {
    throw new FamilyContentError("NOT_FOUND", "Push not found");
  }
  // Non-creator parents cannot see unpublished drafts/schedules belonging to another parent?
  // Spec: 目标学生和全部当前关联家长可见 — so yes they can see scheduled/draft from other parents.
  return "linked_parent";
}

export async function requireCreatorOwnership(
  db: Database,
  input: { actorId: string; push: typeof familyPushes.$inferSelect },
): Promise<void> {
  if (input.actorId !== input.push.creatorParentId) {
    throw new FamilyContentError("FORBIDDEN", "Only the creator can modify this push");
  }
  if (!(await hasActiveRelationship(db, input.actorId, input.push.studentId))) {
    throw new FamilyContentError("FORBIDDEN", "Access denied");
  }
}

export async function listActiveParentIdsForStudent(
  db: Database,
  studentId: string,
): Promise<string[]> {
  const rows = await db
    .select({ parentId: relationships.parentId })
    .from(relationships)
    .where(and(eq(relationships.studentId, studentId), eq(relationships.status, "active")));
  return rows.map((row) => row.parentId);
}

export async function loadPushOrThrow(
  db: Database,
  pushId: string,
): Promise<typeof familyPushes.$inferSelect> {
  const [push] = await db.select().from(familyPushes).where(eq(familyPushes.id, pushId)).limit(1);
  if (!push) {
    throw new FamilyContentError("NOT_FOUND", "Push not found");
  }
  return push;
}

export async function loadUserRole(db: Database, userId: string): Promise<"parent" | "student"> {
  const [user] = await db
    .select({ role: users.role })
    .from(users)
    .where(and(eq(users.id, userId), ne(users.role, "admin")))
    .limit(1);
  if (!user || (user.role !== "parent" && user.role !== "student")) {
    throw new FamilyContentError("FORBIDDEN", "Access denied");
  }
  return user.role;
}
