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
  ownedGeneration: number | null;
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
      ownedGeneration: null,
    })
    .where(eq(mediaPurgeIntents.mediaId, mediaId));
}

/**
 * After prepare takes ownership, any external/finalize uncertainty stays fail-closed:
 * keep purging + prepared + owned_generation so the same generation can retry.
 */
async function recordOwnedPurgeFailure(
  db: Database,
  mediaId: string,
  category: string,
  now: Date,
): Promise<void> {
  await db
    .update(mediaPurgeIntents)
    .set({
      lastErrorCategory: category,
      updatedAt: now,
    })
    .where(eq(mediaPurgeIntents.mediaId, mediaId));
}

/**
 * prepare → external idempotent delete → finalize.
 * Physical object-store I/O never runs inside a DB transaction.
 *
 * prepare takes durable purge ownership (status=purging + owned_generation).
 * Attach may only cancel pending intents before ownership; prepared blocks attach.
 * Once owned, purgeSafe/purgeStaging/finalize errors never restore ready/attach.
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
      return {
        kind: "noop",
        mediaId,
        safeObjectKey: null,
        stagingObjectKey: null,
        ownedGeneration: null,
      };
    }

    if (media.status === "purged") {
      await completeIntent(tx, mediaId, now, null);
      return {
        kind: "noop",
        mediaId,
        safeObjectKey: null,
        stagingObjectKey: null,
        ownedGeneration: null,
      };
    }

    const [intent] = await tx
      .select()
      .from(mediaPurgeIntents)
      .where(eq(mediaPurgeIntents.mediaId, mediaId))
      .limit(1);

    // Already owns cleanup — re-enter physical/finalize path with same generation.
    // Do this before still-referenced handling so owned rows never restore ready.
    if (
      media.status === "purging" &&
      intent?.status === "prepared" &&
      intent.ownedGeneration != null &&
      intent.ownedGeneration === media.purgeGeneration
    ) {
      if (media.referenceCount > 0) {
        throw new Error("media purge prepare saw active references under ownership");
      }
      return {
        kind: "purge",
        mediaId: media.id,
        safeObjectKey: media.safeObjectKey,
        stagingObjectKey: media.stagingObjectKey,
        ownedGeneration: intent.ownedGeneration,
      };
    }

    if (media.referenceCount > 0) {
      // Physical purge has not started — cancel pending intent only.
      await completeIntent(tx, mediaId, now, "still_referenced");
      return {
        kind: "noop",
        mediaId,
        safeObjectKey: null,
        stagingObjectKey: null,
        ownedGeneration: null,
      };
    }

    if (intent?.status === "completed") {
      return {
        kind: "noop",
        mediaId,
        safeObjectKey: null,
        stagingObjectKey: null,
        ownedGeneration: null,
      };
    }

    if (!media.purgeAfter || media.purgeAfter.getTime() > now.getTime()) {
      throw new Error("media purge not due");
    }

    if (media.status !== "ready" && media.status !== "revoked" && media.status !== "rejected") {
      throw new Error(`media purge blocked for status=${media.status}`);
    }

    await revokeCapabilitiesForMediaInTx(tx, media.id, now);

    const nextGeneration = media.purgeGeneration + 1;
    await tx
      .update(mediaObjects)
      .set({
        status: "purging",
        purgeGeneration: nextGeneration,
        updatedAt: now,
      })
      .where(eq(mediaObjects.id, media.id));

    await tx
      .update(mediaPurgeIntents)
      .set({
        status: "prepared",
        ownedGeneration: nextGeneration,
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
      ownedGeneration: nextGeneration,
    };
  });
}

async function finalizeMediaPurge(
  db: Database,
  mediaId: string,
  ownedGeneration: number,
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

    const [intent] = await tx
      .select()
      .from(mediaPurgeIntents)
      .where(eq(mediaPurgeIntents.mediaId, mediaId))
      .limit(1);

    if (
      media.status !== "purging" ||
      intent?.status !== "prepared" ||
      intent.ownedGeneration == null ||
      intent.ownedGeneration !== ownedGeneration ||
      media.purgeGeneration !== ownedGeneration
    ) {
      // Stale worker without ownership — fail closed; never restore readable state.
      return;
    }

    if (media.referenceCount > 0) {
      // Should be unreachable while ownership holds; fail closed without restoring bytes.
      throw new Error("media purge finalize saw active references under ownership");
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
        purgeGeneration: ownedGeneration,
      },
    });
  });
}

/**
 * Worker handler: prepare (short TX) → physical purge (outside TX) → finalize (short TX).
 * Idempotent on replay / lease expiry / dead replay. Any post-prepare failure keeps
 * purging/prepared ownership so attach cannot re-open deleted or uncertain bytes.
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
  if (prepared.ownedGeneration == null) {
    throw new Error("purge prepare missing owned generation");
  }

  try {
    if (prepared.safeObjectKey) {
      await mediaStore.purgeSafe(prepared.safeObjectKey);
    }
  } catch {
    await recordOwnedPurgeFailure(db, mediaId, "safe_purge_failed", new Date());
    throw new Error("media safe purge failed");
  }

  try {
    if (prepared.stagingObjectKey) {
      await mediaStore.purgeStaging(prepared.stagingObjectKey);
    }
  } catch {
    await recordOwnedPurgeFailure(db, mediaId, "staging_purge_failed", new Date());
    throw new Error("media staging purge failed");
  }

  try {
    await finalizeMediaPurge(db, mediaId, prepared.ownedGeneration, new Date());
  } catch (error) {
    await recordOwnedPurgeFailure(db, mediaId, "finalize_failed", new Date());
    throw error;
  }
}
