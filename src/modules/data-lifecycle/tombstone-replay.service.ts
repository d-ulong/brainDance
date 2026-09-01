import type { Database } from "@/db";
import { deletionTombstones } from "@/db/schema";
import { DELETION_TARGET_TYPE } from "@/modules/data-lifecycle/constants";
import {
  countActivePrivateGrantsForStudent,
  countActiveRelationshipsForStudent,
  replayRelationshipAndGrantRevocationForStudent,
} from "@/modules/family-access/account-deletion.service";
import { replayStudentIdentityTombstone } from "@/modules/identity/account-deletion.service";
import {
  replayPrivateGrantRevocationForStudent,
  replayReflectionBodiesTombstoneForStudent,
  replayReflectionBodyTombstoneById,
} from "@/modules/reflection-privacy/account-deletion.service";
import {
  countNonEmptyTrainingPayloadsForStudent,
  replayTrainingPayloadTombstoneForStudent,
} from "@/modules/training/account-deletion.service";

export async function applyTombstonesBeforeProjectionRebuild(db: Database): Promise<number> {
  const tombstones = await db.select().from(deletionTombstones);
  let applied = 0;

  for (const tombstone of tombstones) {
    if (tombstone.targetType === DELETION_TARGET_TYPE.STUDENT_ACCOUNT) {
      applied += await db.transaction(async (tx) => {
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

        const relationshipReplay = await replayRelationshipAndGrantRevocationForStudent(tx, {
          studentId: tombstone.studentId,
          purgedAt: tombstone.purgedAt,
        });
        count += relationshipReplay.relationshipsEnded + relationshipReplay.grantsRevoked;

        return count;
      });
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
}
