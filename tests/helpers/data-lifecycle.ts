import { upsertDailyReflection } from "@/modules/reflection-privacy/upsert-daily-reflection.service";
import { grantPrivateAccess } from "@/modules/reflection-privacy/grant-private-access.service";
import { toFamilyDate } from "@/modules/time-policy/to-family-date";
import { createMemoryArtifactStore } from "@/modules/data-lifecycle/private-artifact-store";
import { DataLifecycleError } from "@/modules/data-lifecycle/errors";

import type { TestDb } from "./db";

export function createTestArtifactStore() {
  return createMemoryArtifactStore();
}

export function createFaultInjectedArtifactStore(options?: {
  failPut?: boolean;
  failOpenOnce?: boolean;
  failPurge?: boolean;
  failRevoke?: boolean;
  putDelayMs?: number;
}) {
  const base = createMemoryArtifactStore();

  return {
    ...base,
    async put(key: string, content: Buffer) {
      if (options?.failPut) {
        throw new DataLifecycleError("ARTIFACT_UNAVAILABLE", "Injected artifact put failure");
      }
      if (options?.putDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.putDelayMs));
      }
      return base.put(key, content);
    },
    async openOnce(key: string) {
      if (options?.failOpenOnce) {
        throw new DataLifecycleError("ARTIFACT_UNAVAILABLE", "Injected artifact open failure");
      }
      return base.openOnce(key);
    },
    async purge(key: string) {
      if (options?.failPurge) {
        throw new DataLifecycleError("ARTIFACT_UNAVAILABLE", "Injected artifact purge failure");
      }
      return base.purge(key);
    },
    async revoke(key: string) {
      if (options?.failRevoke) {
        throw new DataLifecycleError("ARTIFACT_UNAVAILABLE", "Injected artifact revoke failure");
      }
      return base.revoke(key);
    },
  };
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
