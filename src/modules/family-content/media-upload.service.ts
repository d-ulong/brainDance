import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";

import type { Database } from "@/db";
import { mediaObjects } from "@/db/schema";
import { appendAuditEvent } from "@/modules/audit/append-audit-event";
import {
  assertStudentNotFrozenForFamilyContent,
  requireParentLinkedToStudent,
} from "@/modules/family-content/access";
import { FamilyContentError } from "@/modules/family-content/errors";
import type { MediaScanner } from "@/modules/family-content/media-scanner";
import { reencodeSafeImage } from "@/modules/family-content/media-reencode";
import type { PrivateMediaStore } from "@/modules/family-content/private-media-store";
import {
  assertDeclaredMatchesDetected,
  assertUploadSize,
  detectImageMimeFromMagic,
  normalizeDeclaredMime,
} from "@/modules/family-content/media-validate";
import { hashIdempotencyPayload } from "@/modules/schedule/normalize-idempotency-payload";
import { hasActiveRelationship } from "@/modules/family-access/authorization.service";

export type MediaObjectDto = {
  mediaId: string;
  status: string;
  declaredMime: string;
  detectedMime: string | null;
  width: number | null;
  height: number | null;
  byteSize: number;
  readyAt: string | null;
};

export type UploadMediaInput = {
  actorId: string;
  studentId: string;
  declaredMime: string;
  bytes: Buffer;
  idempotencyKey: string;
  requestId?: string;
  now?: Date;
  mediaStore: PrivateMediaStore;
  scanner: MediaScanner;
};

function toMediaDto(row: typeof mediaObjects.$inferSelect): MediaObjectDto {
  return {
    mediaId: row.id,
    status: row.status,
    declaredMime: row.declaredMime,
    detectedMime: row.detectedMime,
    width: row.width,
    height: row.height,
    byteSize: row.byteSize,
    readyAt: row.readyAt?.toISOString() ?? null,
  };
}

async function findUploadReplay(
  db: Database,
  uploaderId: string,
  idempotencyKey: string,
  payloadHash: string,
): Promise<{ media: MediaObjectDto; idempotentReplay: boolean } | null> {
  const [existing] = await db
    .select()
    .from(mediaObjects)
    .where(
      and(
        eq(mediaObjects.uploaderId, uploaderId),
        eq(mediaObjects.createIdempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);

  if (!existing) {
    return null;
  }
  if (existing.createIdempotencyPayloadHash !== payloadHash) {
    throw new FamilyContentError(
      "IDEMPOTENCY_CONFLICT",
      "Media upload idempotency payload mismatch",
    );
  }
  return { media: toMediaDto(existing), idempotentReplay: true };
}

async function assertUploaderMayUploadForStudent(
  db: Database,
  actorId: string,
  studentId: string,
): Promise<void> {
  await assertStudentNotFrozenForFamilyContent(db, studentId, "write");
  if (actorId === studentId) {
    return;
  }
  await requireParentLinkedToStudent(db, actorId, studentId);
}

async function markRejected(
  db: Database,
  mediaStore: PrivateMediaStore,
  mediaId: string,
  stagingKey: string,
  scanResult: "rejected" | "error",
  category: string,
  now: Date,
): Promise<void> {
  await db
    .update(mediaObjects)
    .set({
      status: "rejected",
      scanResult,
      scanErrorCategory: category,
      updatedAt: now,
    })
    .where(eq(mediaObjects.id, mediaId));
  try {
    await mediaStore.deleteStaging(stagingKey);
  } catch {
    // best-effort staging cleanup
  }
}

export async function getMediaObjectDto(
  db: Database,
  mediaId: string,
): Promise<MediaObjectDto | null> {
  const [row] = await db.select().from(mediaObjects).where(eq(mediaObjects.id, mediaId)).limit(1);
  return row ? toMediaDto(row) : null;
}

export async function uploadFamilyMedia(
  db: Database,
  input: UploadMediaInput,
): Promise<{ media: MediaObjectDto; idempotentReplay: boolean }> {
  const now = input.now ?? new Date();
  assertUploadSize(input.bytes.length);
  const declaredMime = normalizeDeclaredMime(input.declaredMime);
  const contentSha = createHash("sha256").update(input.bytes).digest("hex");
  const payloadHash = hashIdempotencyPayload({
    studentId: input.studentId,
    declaredMime,
    contentSha256: contentSha,
    byteSize: input.bytes.length,
  });

  const replay = await findUploadReplay(db, input.actorId, input.idempotencyKey, payloadHash);
  if (replay) {
    return replay;
  }

  await assertUploaderMayUploadForStudent(db, input.actorId, input.studentId);

  const detected = detectImageMimeFromMagic(input.bytes);
  if (!detected) {
    throw new FamilyContentError("VALIDATION_ERROR", "Unrecognized image format");
  }
  assertDeclaredMatchesDetected(declaredMime, detected);

  const mediaId = randomUUID();
  const stagingKey = `staging/${input.studentId}/${mediaId}`;
  const safeKey = `safe/${input.studentId}/${mediaId}`;

  const inserted = await db.transaction(async (tx) => {
    const replayInTx = await findUploadReplay(
      tx,
      input.actorId,
      input.idempotencyKey,
      payloadHash,
    );
    if (replayInTx) {
      return { kind: "replay" as const, result: replayInTx };
    }

    await assertUploaderMayUploadForStudent(tx, input.actorId, input.studentId);

    const [row] = await tx
      .insert(mediaObjects)
      .values({
        id: mediaId,
        uploaderId: input.actorId,
        status: "staging",
        declaredMime,
        detectedMime: detected,
        byteSize: input.bytes.length,
        stagingObjectKey: stagingKey,
        scanResult: "pending",
        createIdempotencyKey: input.idempotencyKey,
        createIdempotencyPayloadHash: payloadHash,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({
        target: [mediaObjects.uploaderId, mediaObjects.createIdempotencyKey],
      })
      .returning();

    if (!row) {
      const raced = await findUploadReplay(tx, input.actorId, input.idempotencyKey, payloadHash);
      if (raced) {
        return { kind: "replay" as const, result: raced };
      }
      throw new FamilyContentError(
        "IDEMPOTENCY_CONFLICT",
        "Media upload idempotency payload mismatch",
      );
    }

    return { kind: "created" as const, row };
  });

  if (inserted.kind === "replay") {
    return inserted.result;
  }

  try {
    await input.mediaStore.putStaging(stagingKey, input.bytes);
  } catch {
    await db
      .update(mediaObjects)
      .set({
        status: "rejected",
        scanResult: "error",
        scanErrorCategory: "staging_write_failed",
        updatedAt: new Date(),
      })
      .where(eq(mediaObjects.id, mediaId));
    throw new FamilyContentError("MEDIA_UNAVAILABLE", "Failed to store staging object");
  }

  await db
    .update(mediaObjects)
    .set({ status: "processing", updatedAt: new Date() })
    .where(eq(mediaObjects.id, mediaId));

  const scan = await input.scanner.scan(input.bytes, declaredMime);
  if (scan.outcome !== "clean") {
    await markRejected(
      db,
      input.mediaStore,
      mediaId,
      stagingKey,
      scan.outcome === "rejected" ? "rejected" : "error",
      scan.category,
      new Date(),
    );
    throw new FamilyContentError("MEDIA_REJECTED", "Media scan rejected upload");
  }

  let reencoded;
  try {
    reencoded = await reencodeSafeImage(input.bytes, detected);
  } catch (error) {
    await markRejected(
      db,
      input.mediaStore,
      mediaId,
      stagingKey,
      "rejected",
      "reencode_failed",
      new Date(),
    );
    if (error instanceof FamilyContentError) {
      throw error;
    }
    throw new FamilyContentError("MEDIA_REJECTED", "Image re-encode failed");
  }

  try {
    await input.mediaStore.promoteSafe(stagingKey, safeKey, reencoded.bytes);
  } catch {
    await markRejected(
      db,
      input.mediaStore,
      mediaId,
      stagingKey,
      "error",
      "promote_failed",
      new Date(),
    );
    throw new FamilyContentError("MEDIA_UNAVAILABLE", "Failed to promote safe object");
  }

  const readyAt = new Date();
  const [ready] = await db
    .update(mediaObjects)
    .set({
      status: "ready",
      scanResult: "clean",
      scanErrorCategory: null,
      detectedMime: reencoded.mime,
      contentSha256: reencoded.sha256,
      safeByteSize: reencoded.bytes.length,
      width: reencoded.width,
      height: reencoded.height,
      safeObjectKey: safeKey,
      readyAt,
      updatedAt: readyAt,
    })
    .where(eq(mediaObjects.id, mediaId))
    .returning();

  await appendAuditEvent(db, {
    actorId: input.actorId,
    action: "media.uploaded",
    resourceType: "media_object",
    resourceId: mediaId,
    requestId: input.requestId ?? null,
    idempotencyKey: `audit:media-upload:${input.idempotencyKey}`,
    metadata: {
      studentId: input.studentId,
      status: "ready",
      declaredMime,
      detectedMime: reencoded.mime,
      byteSize: input.bytes.length,
      safeByteSize: reencoded.bytes.length,
      width: reencoded.width,
      height: reencoded.height,
    },
  });

  return { media: toMediaDto(ready!), idempotentReplay: false };
}

export async function assertMediaReadyForAttach(
  db: Database,
  mediaId: string,
  actorId: string,
): Promise<typeof mediaObjects.$inferSelect> {
  await db.execute(sql`SELECT id FROM media_objects WHERE id = ${mediaId}::uuid FOR UPDATE`);
  const [media] = await db.select().from(mediaObjects).where(eq(mediaObjects.id, mediaId)).limit(1);
  if (!media || media.status !== "ready") {
    throw new FamilyContentError("NOT_FOUND", "Media not found");
  }
  // Uploader or linked parent/student already checked at upload; attach requires ready only.
  // Keep actor check loose: media must exist and be ready; resource auth is separate.
  void actorId;
  return media;
}

export async function assertActorCanUseReadyMedia(
  db: Database,
  mediaId: string,
  actorId: string,
  studentId: string,
): Promise<typeof mediaObjects.$inferSelect> {
  const media = await assertMediaReadyForAttach(db, mediaId, actorId);
  if (media.uploaderId !== actorId) {
    // Allow student to use media they uploaded; parent only their own uploads for attach.
    throw new FamilyContentError("FORBIDDEN", "Access denied");
  }
  if (actorId !== studentId) {
    if (!(await hasActiveRelationship(db, actorId, studentId))) {
      throw new FamilyContentError("FORBIDDEN", "Access denied");
    }
  }
  return media;
}
