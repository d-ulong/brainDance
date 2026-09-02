import { eq, sql } from "drizzle-orm";

import type { Database } from "@/db";
import { mediaObjects, mediaPurgeIntents } from "@/db/schema";
import { appendAuditEvent } from "@/modules/audit/append-audit-event";
import { FAMILY_CONTENT_EVENT_TYPES } from "@/modules/family-content/constants";
import { revokeCapabilitiesForMediaInTx } from "@/modules/family-content/media-capability.service";
import type { PrivateMediaStore } from "@/modules/family-content/private-media-store";
import type { ClaimedOutboxEvent } from "@/modules/outbox/process-outbox-event.service";

/**
 * Worker handler: physically purge unreferenced ready media after purge_after.
 * Idempotent on replay — already purged / re-referenced / not due => successful no-op.
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
      await completeIntent(tx, mediaId, now, "still_referenced");
      return;
    }

    if (!media.purgeAfter || media.purgeAfter.getTime() > now.getTime()) {
      // Not due yet — leave pending; outbox availableAt should gate, but be safe.
      throw new Error("media purge not due");
    }

    await revokeCapabilitiesForMediaInTx(tx, media.id, now);

    if (media.safeObjectKey) {
      await mediaStore.purgeSafe(media.safeObjectKey);
    }
    if (media.stagingObjectKey) {
      await mediaStore.purgeStaging(media.stagingObjectKey);
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
