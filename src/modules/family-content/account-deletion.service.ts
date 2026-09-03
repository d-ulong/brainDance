import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";

import type { Database } from "@/db";
import {
  familyPushes,
  familyPushVersions,
  mediaObjects,
  mediaPurgeIntents,
  mediaReadCapabilities,
  mediaReferences,
  pushAnswerVersions,
  pushAnswers,
  pushCommentVersions,
  pushComments,
} from "@/db/schema";
import { appendAuditEvent } from "@/modules/audit/append-audit-event";
import { revokeAllMediaForStudentInTx } from "@/modules/family-content/media-reference.service";

type DeletionTxFailureHook = () => Promise<void> | void;

/** TEST ONLY — throws inside the deletion business TX to prove full rollback. */
let deletionTxFailureHookForTest: DeletionTxFailureHook | null = null;

export function setFamilyContentDeletionTxFailureHookForTest(
  hook: DeletionTxFailureHook | null,
): void {
  deletionTxFailureHookForTest = hook;
}

/**
 * Cancel unpublished scheduled pushes for a student during account deletion.
 */
export async function cancelScheduledPushesForStudentDeletion(
  tx: Database,
  input: { studentId: string; now: Date },
): Promise<number> {
  const scheduled = await tx
    .select({ id: familyPushes.id })
    .from(familyPushes)
    .where(
      and(eq(familyPushes.studentId, input.studentId), eq(familyPushes.status, "scheduled")),
    );

  for (const push of scheduled) {
    await tx
      .update(familyPushes)
      .set({ status: "cancelled", updatedAt: input.now })
      .where(and(eq(familyPushes.id, push.id), eq(familyPushes.status, "scheduled")));

    await appendAuditEvent(tx, {
      actorId: null,
      action: "family_push.cancelled",
      resourceType: "family_push",
      resourceId: push.id,
      idempotencyKey: `audit:deletion-push-cancelled:${push.id}`,
      metadata: { studentId: input.studentId, reason: "account_deletion" },
    });
  }

  return scheduled.length;
}

/**
 * Clear M7 readable bodies, revoke media refs/capabilities, mark pushes deleted.
 * Called from Data Lifecycle PURGE_BODIES via explicit interface.
 * Produces stable-idempotent audit + purge intents/outbox in the same TX.
 */
export async function purgeFamilyContentBodiesForStudent(
  tx: Database,
  input: { studentId: string; now: Date },
): Promise<{
  pushesCleared: number;
  answersCleared: number;
  commentsCleared: number;
  mediaRefsRevoked: number;
}> {
  await cancelScheduledPushesForStudentDeletion(tx, input);

  const pushes = await tx
    .select({ id: familyPushes.id })
    .from(familyPushes)
    .where(eq(familyPushes.studentId, input.studentId));

  const pushIds = pushes.map((p) => p.id);

  let answersCleared = 0;
  let commentsCleared = 0;

  if (pushIds.length > 0) {
    const versions = await tx
      .select({ id: familyPushVersions.id })
      .from(familyPushVersions)
      .where(inArray(familyPushVersions.pushId, pushIds));

    if (versions.length > 0) {
      await tx
        .update(familyPushVersions)
        .set({ body: "", linkUrl: null })
        .where(
          inArray(
            familyPushVersions.id,
            versions.map((v) => v.id),
          ),
        );
    }

    await tx
      .update(familyPushes)
      .set({ status: "deleted", updatedAt: input.now })
      .where(
        and(
          eq(familyPushes.studentId, input.studentId),
          sql`${familyPushes.status} <> 'deleted'`,
        ),
      );

    const answers = await tx
      .select({ id: pushAnswers.id })
      .from(pushAnswers)
      .where(eq(pushAnswers.studentId, input.studentId));

    if (answers.length > 0) {
      const answerIds = answers.map((a) => a.id);
      const updatedAnswers = await tx
        .update(pushAnswerVersions)
        .set({ body: "" })
        .where(inArray(pushAnswerVersions.answerId, answerIds))
        .returning({ id: pushAnswerVersions.id });
      answersCleared = updatedAnswers.length;
    }

    const comments = await tx
      .select({ id: pushComments.id })
      .from(pushComments)
      .where(inArray(pushComments.pushId, pushIds));

    if (comments.length > 0) {
      const commentIds = comments.map((c) => c.id);
      const updatedComments = await tx
        .update(pushCommentVersions)
        .set({ body: "" })
        .where(inArray(pushCommentVersions.commentId, commentIds))
        .returning({ id: pushCommentVersions.id });
      commentsCleared = updatedComments.length;

      await tx
        .update(pushComments)
        .set({ deletedAt: input.now, updatedAt: input.now })
        .where(inArray(pushComments.id, commentIds));
    }
  }

  const mediaRefsRevoked = await revokeAllMediaForStudentInTx(tx, input.studentId, input.now);

  if (deletionTxFailureHookForTest) {
    await deletionTxFailureHookForTest();
  }

  await appendAuditEvent(tx, {
    actorId: null,
    action: "family_content.purged",
    resourceType: "student_account",
    resourceId: input.studentId,
    // Stable key — must not include wall-clock so tombstone replay does not duplicate audits.
    idempotencyKey: `audit:family-content-purge:${input.studentId}`,
    metadata: {
      pushesTouched: pushIds.length,
      answersCleared,
      commentsCleared,
      mediaRefsRevoked,
    },
  });

  return {
    pushesCleared: pushIds.length,
    answersCleared,
    commentsCleared,
    mediaRefsRevoked,
  };
}

/** Tombstone replay: re-run body clear + media revoke before projection rebuild. */
export async function replayFamilyContentTombstoneForStudent(
  tx: Database,
  input: { studentId: string; purgedAt: Date },
): Promise<number> {
  const result = await purgeFamilyContentBodiesForStudent(tx, {
    studentId: input.studentId,
    now: input.purgedAt,
  });
  return (
    result.pushesCleared +
    result.answersCleared +
    result.commentsCleared +
    result.mediaRefsRevoked
  );
}

/**
 * Restore canary: deleted bodies empty, no active media refs, no live capability,
 * and student media objects are revoked/rejected/purged with cleanup intent.
 */
export async function assertFamilyContentDeletionCanary(
  db: Database,
  studentId: string,
): Promise<void> {
  const nonEmptyPushBodies = await db
    .select({ id: familyPushVersions.id })
    .from(familyPushVersions)
    .innerJoin(familyPushes, eq(familyPushVersions.pushId, familyPushes.id))
    .where(
      and(
        eq(familyPushes.studentId, studentId),
        sql`(length(trim(${familyPushVersions.body})) > 0 OR ${familyPushVersions.linkUrl} IS NOT NULL)`,
      ),
    )
    .limit(1);

  if (nonEmptyPushBodies.length > 0) {
    throw new Error("Family content canary failed: push body still readable");
  }

  const nonEmptyAnswers = await db
    .select({ id: pushAnswerVersions.id })
    .from(pushAnswerVersions)
    .innerJoin(pushAnswers, eq(pushAnswerVersions.answerId, pushAnswers.id))
    .where(
      and(
        eq(pushAnswers.studentId, studentId),
        sql`length(trim(${pushAnswerVersions.body})) > 0`,
      ),
    )
    .limit(1);

  if (nonEmptyAnswers.length > 0) {
    throw new Error("Family content canary failed: answer body still readable");
  }

  const activeRefs = await db
    .select({ id: mediaReferences.id })
    .from(mediaReferences)
    .where(and(eq(mediaReferences.studentId, studentId), isNull(mediaReferences.revokedAt)))
    .limit(1);

  if (activeRefs.length > 0) {
    throw new Error("Family content canary failed: active media reference remains");
  }

  const liveCaps = await db
    .select({ id: mediaReadCapabilities.id })
    .from(mediaReadCapabilities)
    .where(
      and(eq(mediaReadCapabilities.studentId, studentId), isNull(mediaReadCapabilities.revokedAt)),
    )
    .limit(1);

  if (liveCaps.length > 0) {
    throw new Error("Family content canary failed: live media capability remains");
  }

  const readableMedia = await db
    .select({ id: mediaObjects.id })
    .from(mediaObjects)
    .where(and(eq(mediaObjects.studentId, studentId), eq(mediaObjects.status, "ready")))
    .limit(1);

  if (readableMedia.length > 0) {
    throw new Error("Family content canary failed: ready media remains after deletion");
  }

  const uncleared = await db
    .select({ id: mediaObjects.id, status: mediaObjects.status })
    .from(mediaObjects)
    .where(
      and(
        eq(mediaObjects.studentId, studentId),
        ne(mediaObjects.status, "purged"),
        ne(mediaObjects.status, "revoked"),
        ne(mediaObjects.status, "rejected"),
        ne(mediaObjects.status, "purging"),
      ),
    )
    .limit(1);

  if (uncleared.length > 0) {
    throw new Error("Family content canary failed: media not in revoke/cleanup state");
  }

  const mediasNeedingIntent = await db
    .select({ id: mediaObjects.id })
    .from(mediaObjects)
    .where(
      and(
        eq(mediaObjects.studentId, studentId),
        sql`${mediaObjects.status} IN ('revoked', 'rejected', 'purging')`,
      ),
    );

  for (const media of mediasNeedingIntent) {
    const [intent] = await db
      .select()
      .from(mediaPurgeIntents)
      .where(eq(mediaPurgeIntents.mediaId, media.id))
      .limit(1);
    if (
      !intent ||
      (intent.status !== "pending" &&
        intent.status !== "prepared" &&
        intent.status !== "completed")
    ) {
      throw new Error("Family content canary failed: missing media purge intent");
    }
  }
}
