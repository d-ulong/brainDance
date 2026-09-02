import { eq } from "drizzle-orm";

import type { Database } from "@/db";
import { deletionTombstones } from "@/db/schema";
import { DELETION_TARGET_TYPE } from "@/modules/data-lifecycle/constants";
import { DataLifecycleError } from "@/modules/data-lifecycle/errors";
import {
  purgeExportArtifactKeys,
  revokeReadyExportJobsForStudentInTx,
} from "@/modules/data-lifecycle/freeze-guard.service";
import type { PrivateArtifactStore } from "@/modules/data-lifecycle/private-artifact-store";
import {
  countActiveRelationshipsForStudent,
  replayRelationshipRevocationForStudent,
} from "@/modules/family-access/account-deletion.service";
import { replayStudentIdentityTombstone } from "@/modules/identity/account-deletion.service";
import { resetProjectionsAfterStudentDeletion } from "@/modules/projection/account-deletion.service";
import {
  countActivePrivateGrantsForStudent,
  replayPrivateGrantRevocationForStudent,
  replayReflectionBodiesTombstoneForStudent,
  replayReflectionBodyTombstoneById,
} from "@/modules/reflection-privacy/account-deletion.service";
import { cancelPendingScheduleItemsForStudent } from "@/modules/schedule/account-deletion.service";
import {
  countNonEmptyTrainingPayloadsForStudent,
  replayTrainingPayloadTombstoneForStudent,
} from "@/modules/training/account-deletion.service";
import {
  assertFamilyContentDeletionCanary,
  replayFamilyContentTombstoneForStudent,
} from "@/modules/family-content/account-deletion.service";

const TOMBSTONE_PAYLOAD_PENDING_KEYS = "artifactPurgePendingKeys";
const TOMBSTONE_PAYLOAD_LAST_FAILED_AT = "artifactPurgeLastFailedAt";

export type ApplyTombstonesBeforeProjectionRebuildInput = {
  artifactStore?: PrivateArtifactStore;
  /** Test hook: invoked after DB transaction commits, before external artifact purge. */
  afterReplayCommitForTest?: () => void | Promise<void>;
};

function dedupeArtifactKeys(keys: string[]): string[] {
  return [...new Set(keys.filter((key) => key.length > 0))];
}

function assertPendingArtifactKeyArray(value: unknown, context: string): string[] {
  if (!Array.isArray(value)) {
    throw new DataLifecycleError("STATE_CONFLICT", `Invalid ${context}: expected string array`);
  }

  for (const key of value) {
    if (typeof key !== "string" || key.length === 0) {
      throw new DataLifecycleError(
        "STATE_CONFLICT",
        `Invalid ${context}: all elements must be non-empty strings`,
      );
    }
  }

  return value;
}

function readPendingArtifactPurgeKeys(
  payload: Record<string, unknown> | null | undefined,
): string[] {
  const pending = payload?.[TOMBSTONE_PAYLOAD_PENDING_KEYS];
  if (pending === undefined || pending === null) {
    return [];
  }

  if (typeof pending === "string") {
    try {
      const parsed = JSON.parse(pending) as unknown;
      return assertPendingArtifactKeyArray(parsed, TOMBSTONE_PAYLOAD_PENDING_KEYS);
    } catch (error) {
      if (error instanceof DataLifecycleError) {
        throw error;
      }
      throw new DataLifecycleError(
        "STATE_CONFLICT",
        `Malformed ${TOMBSTONE_PAYLOAD_PENDING_KEYS} JSON in tombstone payload`,
      );
    }
  }

  if (Array.isArray(pending)) {
    return assertPendingArtifactKeyArray(pending, TOMBSTONE_PAYLOAD_PENDING_KEYS);
  }

  throw new DataLifecycleError(
    "STATE_CONFLICT",
    `Invalid ${TOMBSTONE_PAYLOAD_PENDING_KEYS} structure in tombstone payload`,
  );
}

async function persistArtifactPurgeIntentInTx(
  db: Database,
  input: {
    tombstoneId: string;
    payload: Record<string, unknown> | null | undefined;
    artifactKeys: string[];
  },
): Promise<void> {
  await db
    .update(deletionTombstones)
    .set({
      payload: {
        ...(input.payload ?? {}),
        [TOMBSTONE_PAYLOAD_PENDING_KEYS]: JSON.stringify(dedupeArtifactKeys(input.artifactKeys)),
      },
    })
    .where(eq(deletionTombstones.id, input.tombstoneId));
}

async function recordArtifactPurgeFailure(
  db: Database,
  input: {
    tombstoneId: string;
    failedAt: Date;
  },
): Promise<void> {
  const [tombstone] = await db
    .select({ payload: deletionTombstones.payload })
    .from(deletionTombstones)
    .where(eq(deletionTombstones.id, input.tombstoneId))
    .limit(1);

  const currentPayload = (tombstone?.payload ?? {}) as Record<string, unknown>;

  await db
    .update(deletionTombstones)
    .set({
      payload: {
        ...currentPayload,
        [TOMBSTONE_PAYLOAD_LAST_FAILED_AT]: input.failedAt.toISOString(),
      },
    })
    .where(eq(deletionTombstones.id, input.tombstoneId));
}

async function clearArtifactPurgePending(
  db: Database,
  tombstoneId: string,
  payload: Record<string, unknown> | null | undefined,
): Promise<void> {
  const nextPayload: Record<string, string | number | boolean | null> = {};

  for (const [key, value] of Object.entries(payload ?? {})) {
    if (key === TOMBSTONE_PAYLOAD_PENDING_KEYS || key === TOMBSTONE_PAYLOAD_LAST_FAILED_AT) {
      continue;
    }
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null
    ) {
      nextPayload[key] = value;
    }
  }

  await db
    .update(deletionTombstones)
    .set({ payload: nextPayload })
    .where(eq(deletionTombstones.id, tombstoneId));
}

async function purgeTombstoneArtifactKeysAfterCommit(
  db: Database,
  input: {
    tombstoneId: string;
    payload: Record<string, unknown> | null | undefined;
    artifactKeys: string[];
    artifactStore?: PrivateArtifactStore;
  },
): Promise<void> {
  const keys = dedupeArtifactKeys(input.artifactKeys);
  if (keys.length === 0) {
    return;
  }

  if (!input.artifactStore) {
    await recordArtifactPurgeFailure(db, {
      tombstoneId: input.tombstoneId,
      failedAt: new Date(),
    });
    throw new DataLifecycleError(
      "ARTIFACT_UNAVAILABLE",
      "Artifact store required for tombstone artifact purge",
    );
  }

  try {
    await purgeExportArtifactKeys(input.artifactStore, keys);
    await clearArtifactPurgePending(db, input.tombstoneId, input.payload);
  } catch (error) {
    await recordArtifactPurgeFailure(db, {
      tombstoneId: input.tombstoneId,
      failedAt: new Date(),
    });
    throw error;
  }
}

export async function applyTombstonesBeforeProjectionRebuild(
  db: Database,
  input?: ApplyTombstonesBeforeProjectionRebuildInput,
): Promise<number> {
  const tombstones = await db.select().from(deletionTombstones);
  let applied = 0;

  for (const tombstone of tombstones) {
    if (tombstone.targetType === DELETION_TARGET_TYPE.STUDENT_ACCOUNT) {
      const tombstonePayload = tombstone.payload as Record<string, unknown> | null | undefined;
      const pendingKeys = readPendingArtifactPurgeKeys(tombstonePayload);

      const replayResult = await db.transaction(async (tx) => {
        let count = 0;

        if (
          await replayStudentIdentityTombstone(tx, {
            studentId: tombstone.targetId,
            deletionRequestId: tombstone.deletionRequestId,
            purgedAt: tombstone.purgedAt,
          })
        ) {
          count += 1;
        }

        count += await replayReflectionBodiesTombstoneForStudent(tx, {
          studentId: tombstone.studentId,
          purgedAt: tombstone.purgedAt,
        });

        count += await replayTrainingPayloadTombstoneForStudent(tx, tombstone.studentId);

        count += await replayFamilyContentTombstoneForStudent(tx, {
          studentId: tombstone.studentId,
          purgedAt: tombstone.purgedAt,
        });

        const relationshipReplay = await replayRelationshipRevocationForStudent(tx, {
          studentId: tombstone.studentId,
          purgedAt: tombstone.purgedAt,
        });
        count += relationshipReplay.relationshipsEnded;

        count += await replayPrivateGrantRevocationForStudent(tx, {
          studentId: tombstone.studentId,
          purgedAt: tombstone.purgedAt,
        });

        count += await cancelPendingScheduleItemsForStudent(tx, tombstone.studentId);

        await resetProjectionsAfterStudentDeletion(tx, {
          studentId: tombstone.studentId,
          now: tombstone.purgedAt,
        });

        const revokedJobs = await revokeReadyExportJobsForStudentInTx(tx, tombstone.studentId);
        count += revokedJobs.revokedCount;

        const artifactKeys = dedupeArtifactKeys([...pendingKeys, ...revokedJobs.artifactKeys]);
        if (artifactKeys.length > 0) {
          await persistArtifactPurgeIntentInTx(tx, {
            tombstoneId: tombstone.id,
            payload: tombstonePayload,
            artifactKeys,
          });
        }

        return {
          count,
          artifactKeys,
        };
      });

      await input?.afterReplayCommitForTest?.();

      await purgeTombstoneArtifactKeysAfterCommit(db, {
        tombstoneId: tombstone.id,
        payload: tombstonePayload,
        artifactKeys: replayResult.artifactKeys,
        artifactStore: input?.artifactStore,
      });

      applied += replayResult.count;
    }

    if (tombstone.targetType === DELETION_TARGET_TYPE.DAILY_REFLECTION) {
      applied += await db.transaction(async (tx) => {
        let count = 0;

        if (
          await replayReflectionBodyTombstoneById(tx, {
            reflectionId: tombstone.targetId,
            purgedAt: tombstone.purgedAt,
          })
        ) {
          count += 1;
        }

        count += await replayPrivateGrantRevocationForStudent(tx, {
          studentId: tombstone.studentId,
          purgedAt: tombstone.purgedAt,
        });

        return count;
      });
    }
  }

  return applied;
}

export async function assertTombstoneInvariants(db: Database, studentId: string): Promise<void> {
  const activeRelationships = await countActiveRelationshipsForStudent(db, studentId);
  const activeGrants = await countActivePrivateGrantsForStudent(db, studentId);
  const nonEmptyPayloads = await countNonEmptyTrainingPayloadsForStudent(db, studentId);

  if (activeRelationships > 0 || activeGrants > 0 || nonEmptyPayloads > 0) {
    throw new Error("Tombstone invariants violated after replay");
  }

  await assertFamilyContentDeletionCanary(db, studentId);
}

export {
  readPendingArtifactPurgeKeys as readTombstoneArtifactPurgePendingKeys,
  TOMBSTONE_PAYLOAD_PENDING_KEYS,
  TOMBSTONE_PAYLOAD_LAST_FAILED_AT,
};
