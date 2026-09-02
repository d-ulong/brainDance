import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import type { Database } from "@/db";
import {
  familyPushVersions,
  mediaObjects,
  mediaPurgeIntents,
  mediaReadCapabilities,
  mediaReferences,
  pushAnswerVersions,
  pushAnswers,
} from "@/db/schema";
import { appendAuditEvent } from "@/modules/audit/append-audit-event";
import {
  FAMILY_CONTENT_EVENT_TYPES,
  MEDIA_PURGE_DAYS,
  type MediaPurpose,
  type MediaResourceType,
} from "@/modules/family-content/constants";
import { assertActorCanUseReadyMedia } from "@/modules/family-content/media-upload.service";
import { appendOutboxEvent } from "@/modules/outbox/append-outbox-event";

export type MediaRefDto = {
  referenceId: string;
  mediaId: string;
  purpose: string;
  status: string;
  detectedMime: string | null;
  width: number | null;
  height: number | null;
};

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export async function attachReadyMediaToResource(
  tx: Database,
  input: {
    actorId: string;
    mediaId: string;
    resourceType: MediaResourceType;
    resourceId: string;
    purpose: MediaPurpose;
    studentId: string;
    now?: Date;
  },
): Promise<typeof mediaReferences.$inferSelect> {
  const now = input.now ?? new Date();
  const media = await assertActorCanUseReadyMedia(
    tx,
    input.mediaId,
    input.actorId,
    input.studentId,
  );

  const [ref] = await tx
    .insert(mediaReferences)
    .values({
      mediaId: media.id,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      purpose: input.purpose,
      studentId: input.studentId,
      createdAt: now,
    })
    .returning();

  const nextCount = media.referenceCount + 1;
  await tx
    .update(mediaObjects)
    .set({
      referenceCount: nextCount,
      unreferencedAt: null,
      purgeAfter: null,
      updatedAt: now,
    })
    .where(eq(mediaObjects.id, media.id));

  // Cancel pending purge intent when re-referenced.
  await tx
    .update(mediaPurgeIntents)
    .set({
      status: "completed",
      completedAt: now,
      updatedAt: now,
      lastErrorCategory: "cancelled_rereferenced",
    })
    .where(
      and(eq(mediaPurgeIntents.mediaId, media.id), eq(mediaPurgeIntents.status, "pending")),
    );

  return ref!;
}

export async function revokeCapabilitiesForReferenceInTx(
  tx: Database,
  referenceId: string,
  now: Date,
): Promise<number> {
  const result = await tx
    .update(mediaReadCapabilities)
    .set({ revokedAt: now })
    .where(
      and(
        eq(mediaReadCapabilities.referenceId, referenceId),
        isNull(mediaReadCapabilities.revokedAt),
      ),
    )
    .returning({ id: mediaReadCapabilities.id });
  return result.length;
}

export async function revokeMediaReferenceInTx(
  tx: Database,
  input: {
    referenceId: string;
    now?: Date;
    actorId?: string | null;
    requestId?: string;
  },
): Promise<void> {
  const now = input.now ?? new Date();
  await tx.execute(
    sql`SELECT id FROM media_references WHERE id = ${input.referenceId}::uuid FOR UPDATE`,
  );
  const [ref] = await tx
    .select()
    .from(mediaReferences)
    .where(eq(mediaReferences.id, input.referenceId))
    .limit(1);
  if (!ref || ref.revokedAt) {
    return;
  }

  await tx
    .update(mediaReferences)
    .set({ revokedAt: now })
    .where(eq(mediaReferences.id, ref.id));

  await revokeCapabilitiesForReferenceInTx(tx, ref.id, now);

  await tx.execute(sql`SELECT id FROM media_objects WHERE id = ${ref.mediaId}::uuid FOR UPDATE`);
  const [media] = await tx
    .select()
    .from(mediaObjects)
    .where(eq(mediaObjects.id, ref.mediaId))
    .limit(1);
  if (!media) {
    return;
  }

  const nextCount = Math.max(0, media.referenceCount - 1);
  const unreferencedAt = nextCount === 0 ? now : null;
  const purgeAfter = nextCount === 0 ? addDays(now, MEDIA_PURGE_DAYS) : null;

  await tx
    .update(mediaObjects)
    .set({
      referenceCount: nextCount,
      unreferencedAt,
      purgeAfter,
      updatedAt: now,
    })
    .where(eq(mediaObjects.id, media.id));

  if (nextCount === 0 && purgeAfter) {
    await tx
      .insert(mediaPurgeIntents)
      .values({
        mediaId: media.id,
        status: "pending",
        purgeAfter,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [mediaPurgeIntents.mediaId],
        set: {
          status: "pending",
          purgeAfter,
          completedAt: null,
          lastErrorCategory: null,
          updatedAt: now,
        },
      });

    await appendOutboxEvent(tx, {
      aggregateType: "media_object",
      aggregateId: media.id,
      eventType: FAMILY_CONTENT_EVENT_TYPES.MEDIA_PURGE_REQUESTED,
      dedupeKey: `family_media.purge_requested:${media.id}:${purgeAfter.toISOString()}`,
      availableAt: purgeAfter,
      payload: {
        mediaId: media.id,
        purgeAfter: purgeAfter.toISOString(),
      },
    });
  }

  await appendAuditEvent(tx, {
    actorId: input.actorId ?? null,
    action: "media.reference_revoked",
    resourceType: "media_reference",
    resourceId: ref.id,
    requestId: input.requestId ?? null,
    idempotencyKey: `audit:media-ref-revoke:${ref.id}:${now.toISOString()}`,
    metadata: {
      mediaId: ref.mediaId,
      resourceType: ref.resourceType,
      purpose: ref.purpose,
      nextReferenceCount: nextCount,
    },
  });
}

export async function listActiveMediaDtosForResource(
  db: Database,
  resourceType: MediaResourceType,
  resourceId: string,
): Promise<MediaRefDto[]> {
  const rows = await db
    .select({
      referenceId: mediaReferences.id,
      mediaId: mediaReferences.mediaId,
      purpose: mediaReferences.purpose,
      status: mediaObjects.status,
      detectedMime: mediaObjects.detectedMime,
      width: mediaObjects.width,
      height: mediaObjects.height,
    })
    .from(mediaReferences)
    .innerJoin(mediaObjects, eq(mediaReferences.mediaId, mediaObjects.id))
    .where(
      and(
        eq(mediaReferences.resourceType, resourceType),
        eq(mediaReferences.resourceId, resourceId),
        isNull(mediaReferences.revokedAt),
      ),
    );

  return rows.map((row) => ({
    referenceId: row.referenceId,
    mediaId: row.mediaId,
    purpose: row.purpose,
    status: row.status,
    detectedMime: row.detectedMime,
    width: row.width,
    height: row.height,
  }));
}

export async function revokeAllReferencesForPushInTx(
  tx: Database,
  pushId: string,
  now: Date,
  actorId?: string | null,
): Promise<number> {
  const versions = await tx
    .select({ id: familyPushVersions.id })
    .from(familyPushVersions)
    .where(eq(familyPushVersions.pushId, pushId));
  if (versions.length === 0) {
    return 0;
  }
  const refs = await tx
    .select()
    .from(mediaReferences)
    .where(
      and(
        eq(mediaReferences.resourceType, "family_push_version"),
        inArray(
          mediaReferences.resourceId,
          versions.map((v) => v.id),
        ),
        isNull(mediaReferences.revokedAt),
      ),
    );

  for (const ref of refs) {
    await revokeMediaReferenceInTx(tx, { referenceId: ref.id, now, actorId });
  }
  return refs.length;
}

export async function revokeAllReferencesForAnswerInTx(
  tx: Database,
  answerId: string,
  now: Date,
  actorId?: string | null,
): Promise<number> {
  const versions = await tx
    .select({ id: pushAnswerVersions.id })
    .from(pushAnswerVersions)
    .where(eq(pushAnswerVersions.answerId, answerId));
  if (versions.length === 0) {
    return 0;
  }
  const refs = await tx
    .select()
    .from(mediaReferences)
    .where(
      and(
        eq(mediaReferences.resourceType, "push_answer_version"),
        inArray(
          mediaReferences.resourceId,
          versions.map((v) => v.id),
        ),
        isNull(mediaReferences.revokedAt),
      ),
    );

  for (const ref of refs) {
    await revokeMediaReferenceInTx(tx, { referenceId: ref.id, now, actorId });
  }
  return refs.length;
}

export async function revokeAllMediaForStudentInTx(
  tx: Database,
  studentId: string,
  now: Date,
): Promise<number> {
  const refs = await tx
    .select()
    .from(mediaReferences)
    .where(and(eq(mediaReferences.studentId, studentId), isNull(mediaReferences.revokedAt)));

  for (const ref of refs) {
    await revokeMediaReferenceInTx(tx, { referenceId: ref.id, now });
  }

  await tx
    .update(mediaReadCapabilities)
    .set({ revokedAt: now })
    .where(
      and(eq(mediaReadCapabilities.studentId, studentId), isNull(mediaReadCapabilities.revokedAt)),
    );

  return refs.length;
}

export async function findAnswerIdForPush(
  db: Database,
  pushId: string,
): Promise<string | null> {
  const [answer] = await db
    .select({ id: pushAnswers.id })
    .from(pushAnswers)
    .where(eq(pushAnswers.pushId, pushId))
    .limit(1);
  return answer?.id ?? null;
}
