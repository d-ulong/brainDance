import { eq, sql } from "drizzle-orm";

import type { Database } from "@/db";
import { mediaObjects, mediaPurgeIntents } from "@/db/schema";
import { appendAuditEvent } from "@/modules/audit/append-audit-event";
import { FAMILY_CONTENT_EVENT_TYPES } from "@/modules/family-content/constants";
import { revokeCapabilitiesForMediaInTx } from "@/modules/family-content/media-capability.service";
import type { PrivateMediaStore } from "@/modules/family-content/private-media-store";
import type { ClaimedOutboxEvent } from "@/modules/outbox/process-outbox-event.service";

type PreparedPurge = {
  kind: "noop" | "purge";
  mediaId: string;
  safeObjectKey: string | null;
  stagingObjectKey: string | null;
};

async function completeIntent(
  tx: Database,
  mediaId: string,
  now: Date,
  category: string | null,
): Promise<void> {
  await tx
    .update(mediaPurgeIntents)
    .set({
      status: "completed",
      completedAt: now,
      updatedAt: now,
      lastErrorCategory: category,
    })
    .where(eq(mediaPurgeIntents.mediaId, mediaId));
}

async function markIntentRetryable(
  db: Database,
  mediaId: string,
  category: string,
  now: Date,
): Promise<void> {
  await db
    .update(mediaPurgeIntents)
    .set({
      status: "pending",
      lastErrorCategory: category,
      updatedAt: now,
      completedAt: null,
    })
    .where(eq(mediaPurgeIntents.mediaId, mediaId));
}

/**
 * prepare → external idempotent delete → finalize.
 * Physical object-store I/O never runs inside a DB transaction.
 */
async function prepareMediaPurge(
  db: Database,
  mediaId: string,
  now: Date,
): Promise<PreparedPurge> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM media_objects WHERE id = ${mediaId}::uuid FOR UPDATE`);
    const [media] = await tx
      .select()
      .from(mediaObjects)
      .where(eq(mediaObjects.id, mediaId))
      .limit(1);

    if (!media) {
      await completeIntent(tx, mediaId, now, "missing_object");
      return { kind: "noop", mediaId, safeObjectKey: null, stagingObjectKey: null };
    }

    if (media.status === "purged") {
      await completeIntent(tx, mediaId, now, null);
      return { kind: "noop", mediaId, safeObjectKey: null, stagingObjectKey: null };
    }

    if (media.referenceCount > 0) {
      await completeIntent(tx, mediaId, now, "still_referenced");
      return { kind: "noop", mediaId, safeObjectKey: null, stagingObjectKey: null };
    }

    const [intent] = await tx
      .select()
      .from(mediaPurgeIntents)
      .where(eq(mediaPurgeIntents.mediaId, mediaId))
      .limit(1);

    if (intent?.status === "completed") {
      return { kind: "noop", mediaId, safeObjectKey: null, stagingObjectKey: null };
    }

    if (!media.purgeAfter || media.purgeAfter.getTime() > now.getTime()) {
      throw new Error("media purge not due");
    }

    await revokeCapabilitiesForMediaInTx(tx, media.id, now);

    await tx
      .update(mediaPurgeIntents)
      .set({
        status: "prepared",
        updatedAt: now,
        lastErrorCategory: null,
        completedAt: null,
      })
      .where(eq(mediaPurgeIntents.mediaId, mediaId));

    return {
      kind: "purge",
      mediaId: media.id,
      safeObjectKey: media.safeObjectKey,
      stagingObjectKey: media.stagingObjectKey,
    };
  });
}

async function finalizeMediaPurge(
  db: Database,
  mediaId: string,
  now: Date,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM media_objects WHERE id = ${mediaId}::uuid FOR UPDATE`);
    const [media] = await tx
      .select()
      .from(mediaObjects)
      .where(eq(mediaObjects.id, mediaId))
      .limit(1);

    if (!media) {
      await completeIntent(tx, mediaId, now, "missing_object");
      return;
    }

    if (media.status === "purged") {
      await completeIntent(tx, mediaId, now, null);
      return;
    }

    if (media.referenceCount > 0) {
      // Re-referenced after prepare — cancel physical cleanup bookkeeping.
      await completeIntent(tx, mediaId, now, "still_referenced");
      return;
    }

    await tx
      .update(mediaObjects)
      .set({
        status: "purged",
        purgedAt: now,
        updatedAt: now,
        safeObjectKey: null,
      })
      .where(eq(mediaObjects.id, media.id));

    await completeIntent(tx, mediaId, now, null);

    await appendAuditEvent(tx, {
      actorId: null,
      action: "media.purged",
      resourceType: "media_object",
      resourceId: media.id,
      idempotencyKey: `audit:media-purged:${media.id}`,
      metadata: {
        eventType: FAMILY_CONTENT_EVENT_TYPES.MEDIA_PURGE_REQUESTED,
      },
    });
  });
}

/**
 * Worker handler: prepare (short TX) → physical purge (outside TX) → finalize (short TX).
 * Idempotent on replay / lease expiry / dead replay. Physical delete success + finalize
 * failure converges on retry without restoring readability.
 */
export async function handleMediaPurgeRequestedV1(
  db: Database,
  event: ClaimedOutboxEvent,
  mediaStore: PrivateMediaStore,
): Promise<void> {
  const mediaId = event.payload.mediaId;
  if (typeof mediaId !== "string") {
    throw new Error("purge_requested payload missing mediaId");
  }

  const now = new Date();
  const prepared = await prepareMediaPurge(db, mediaId, now);
  if (prepared.kind === "noop") {
    return;
  }

  try {
    if (prepared.safeObjectKey) {
      await mediaStore.purgeSafe(prepared.safeObjectKey);
    }
  } catch {
    await markIntentRetryable(db, mediaId, "safe_purge_failed", new Date());
    throw new Error("media safe purge failed");
  }

  try {
    if (prepared.stagingObjectKey) {
      await mediaStore.purgeStaging(prepared.stagingObjectKey);
    }
  } catch {
    await markIntentRetryable(db, mediaId, "staging_purge_failed", new Date());
    throw new Error("media staging purge failed");
  }

  try {
    await finalizeMediaPurge(db, mediaId, new Date());
  } catch (error) {
    // Objects already deleted; keep intent prepared/pending so replay finalizes without
    // restoring readable state. Prefer retryable pending for worker backoff.
    await markIntentRetryable(db, mediaId, "finalize_failed", new Date());
    throw error;
  }
}
