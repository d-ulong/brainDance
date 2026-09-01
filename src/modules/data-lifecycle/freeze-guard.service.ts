import { and, eq, inArray, sql } from "drizzle-orm";

import type { Database } from "@/db";
import { deletionRequests, exportJobs, sessions, users } from "@/db/schema";
import { DELETION_STATUS, DELETION_TARGET_TYPE } from "@/modules/data-lifecycle/constants";
import { DataLifecycleError } from "@/modules/data-lifecycle/errors";
import type { PrivateArtifactStore } from "@/modules/data-lifecycle/private-artifact-store";

export type FreezeMode = "read" | "write";

export async function findActiveStudentAccountFreeze(
  db: Database,
  studentId: string,
): Promise<typeof deletionRequests.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(deletionRequests)
    .where(
      and(
        eq(deletionRequests.targetType, DELETION_TARGET_TYPE.STUDENT_ACCOUNT),
        eq(deletionRequests.targetId, studentId),
        inArray(deletionRequests.status, [DELETION_STATUS.REQUESTED, DELETION_STATUS.FROZEN]),
      ),
    )
    .limit(1);

  return row ?? null;
}

export async function findActiveReflectionFreeze(
  db: Database,
  reflectionId: string,
): Promise<typeof deletionRequests.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(deletionRequests)
    .where(
      and(
        eq(deletionRequests.targetType, DELETION_TARGET_TYPE.DAILY_REFLECTION),
        eq(deletionRequests.targetId, reflectionId),
        inArray(deletionRequests.status, [DELETION_STATUS.REQUESTED, DELETION_STATUS.FROZEN]),
      ),
    )
    .limit(1);

  return row ?? null;
}

export async function isStudentAccountFrozen(db: Database, studentId: string): Promise<boolean> {
  const freeze = await findActiveStudentAccountFreeze(db, studentId);
  return freeze !== null;
}

export async function assertStudentAccountNotFrozen(
  db: Database,
  studentId: string,
  _mode: FreezeMode = "read",
): Promise<void> {
  const freeze = await findActiveStudentAccountFreeze(db, studentId);
  if (freeze) {
    throw new DataLifecycleError("FROZEN", "Student account is frozen for deletion");
  }
}

export async function assertReflectionNotFrozenForDeletion(
  db: Database,
  reflectionId: string,
  _mode: FreezeMode = "read",
): Promise<void> {
  const freeze = await findActiveReflectionFreeze(db, reflectionId);
  if (freeze) {
    throw new DataLifecycleError("FROZEN", "Daily reflection is frozen for deletion");
  }
}

export async function assertStudentScopeNotFrozen(
  db: Database,
  studentId: string,
  options?: { reflectionId?: string; mode?: FreezeMode },
): Promise<void> {
  await assertStudentAccountNotFrozen(db, studentId, options?.mode ?? "read");
  if (options?.reflectionId) {
    await assertReflectionNotFrozenForDeletion(db, options.reflectionId, options?.mode ?? "read");
  }
}

export async function revokeStudentSessions(db: Database, studentId: string): Promise<number> {
  const result = await db.delete(sessions).where(eq(sessions.userId, studentId)).returning({
    id: sessions.id,
  });
  return result.length;
}

export async function incrementStudentAuthorizationEpoch(
  db: Database,
  studentId: string,
): Promise<void> {
  await db
    .update(users)
    .set({
      authorizationEpoch: sql`${users.authorizationEpoch} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(users.id, studentId));
}

export async function revokeReadyExportJobsForStudentInTx(
  db: Database,
  studentId: string,
): Promise<{ revokedCount: number; artifactKeys: string[] }> {
  const jobs = await db
    .select()
    .from(exportJobs)
    .where(
      and(
        eq(exportJobs.studentId, studentId),
        inArray(exportJobs.status, ["pending", "processing", "ready"]),
      ),
    );

  const now = new Date();
  const artifactKeys: string[] = [];
  let revoked = 0;

  for (const job of jobs) {
    await db
      .update(exportJobs)
      .set({ status: "revoked", updatedAt: now })
      .where(eq(exportJobs.id, job.id));

    if (job.artifactKey) {
      artifactKeys.push(job.artifactKey);
      const stagingKey = `${job.artifactKey}.staging`;
      artifactKeys.push(stagingKey);
    }
    revoked += 1;
  }

  return { revokedCount: revoked, artifactKeys };
}

export async function purgeExportArtifactKeys(
  artifactStore: PrivateArtifactStore | undefined,
  artifactKeys: string[],
): Promise<void> {
  if (!artifactStore) {
    return;
  }

  for (const key of artifactKeys) {
    await artifactStore.purge(key);
  }
}

export async function revokeReadyExportJobsForStudent(
  db: Database,
  studentId: string,
  artifactStore?: PrivateArtifactStore,
): Promise<number> {
  const { revokedCount, artifactKeys } = await revokeReadyExportJobsForStudentInTx(db, studentId);
  await purgeExportArtifactKeys(artifactStore, artifactKeys);
  return revokedCount;
}

export async function assertExportJobAccessible(
  db: Database,
  job: typeof exportJobs.$inferSelect,
): Promise<void> {
  if (job.status === "revoked" || job.status === "expired" || job.status === "failed") {
    throw new DataLifecycleError("ARTIFACT_UNAVAILABLE", "Export artifact is no longer available");
  }

  if (job.consumedAt) {
    throw new DataLifecycleError("TOKEN_CONSUMED", "Download token has already been consumed");
  }

  if (job.expiresAt && job.expiresAt.getTime() <= Date.now()) {
    throw new DataLifecycleError("TOKEN_EXPIRED", "Download token has expired");
  }

  await assertStudentAccountNotFrozen(db, job.studentId);
}
