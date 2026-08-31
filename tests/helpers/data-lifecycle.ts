import { eq } from "drizzle-orm";

import { upsertDailyReflection } from "@/modules/reflection-privacy/upsert-daily-reflection.service";
import { grantPrivateAccess } from "@/modules/reflection-privacy/grant-private-access.service";
import { toFamilyDate } from "@/modules/time-policy/to-family-date";
import { createMemoryArtifactStore } from "@/modules/data-lifecycle/private-artifact-store";

import type { TestDb } from "./db";

export function createTestArtifactStore() {
  return createMemoryArtifactStore();
}

export async function seedPrivateReflection(
  db: TestDb,
  input: {
    studentId: string;
    parentId: string;
    body: string;
    familyDate?: string;
  },
) {
  const familyDate = input.familyDate ?? toFamilyDate();
  const upsert = await upsertDailyReflection(db, {
    studentId: input.studentId,
    familyDate,
    visibility: "private",
    body: input.body,
    idempotencyKey: `reflection-${familyDate}-${crypto.randomUUID().slice(0, 8)}`,
  });

  await grantPrivateAccess(db, {
    studentId: input.studentId,
    parentId: input.parentId,
    familyDate,
    idempotencyKey: `grant-${familyDate}-${crypto.randomUUID().slice(0, 8)}`,
  });

  return { reflectionId: upsert.reflection.reflectionId, familyDate };
}

export async function seedSharedReflection(
  db: TestDb,
  input: {
    studentId: string;
    body: string;
    familyDate?: string;
  },
) {
  const familyDate = input.familyDate ?? toFamilyDate();
  const upsert = await upsertDailyReflection(db, {
    studentId: input.studentId,
    familyDate,
    visibility: "normal",
    body: input.body,
    idempotencyKey: `reflection-shared-${familyDate}-${crypto.randomUUID().slice(0, 8)}`,
  });

  return { reflectionId: upsert.reflection.reflectionId, familyDate };
}
