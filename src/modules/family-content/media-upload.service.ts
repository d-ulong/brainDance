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
import type { MediaUploadIdempotencyLock } from "@/modules/family-content/media-upload-idempotency-lock";
import {
  assertDeclaredMatchesDetected,
  assertUploadSize,
  detectImageMimeFromMagic,
  normalizeDeclaredMime,
} from "@/modules/family-content/media-validate";
import type { AllowedMediaMime } from "@/modules/family-content/constants";
import { hashIdempotencyPayload } from "@/modules/schedule/normalize-idempotency-payload";
import { hasActiveRelationship } from "@/modules/family-access/authorization.service";

export type MediaObjectDto = {
  mediaId: string;
  studentId: string;
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
  /** Must bind to the same database authority as `db`. */
  idempotencyLock: MediaUploadIdempotencyLock;
};

function toMediaDto(row: typeof mediaObjects.$inferSelect): MediaObjectDto {
  return {
    mediaId: row.id,
    studentId: row.studentId,
    status: row.status,
    declaredMime: row.declaredMime,
    detectedMime: row.detectedMime,
    width: row.width,
    height: row.height,
    byteSize: row.byteSize,
    readyAt: row.readyAt?.toISOString() ?? null,
  };
}

async function findExistingUpload(
  db: Database,
  uploaderId: string,
  idempotencyKey: string,
): Promise<typeof mediaObjects.$inferSelect | null> {
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
  return existing ?? null;
}

function assertPayloadHash(
  existing: typeof mediaObjects.$inferSelect,
  payloadHash: string,
): void {
  if (existing.createIdempotencyPayloadHash !== payloadHash) {
    throw new FamilyContentError(
      "IDEMPOTENCY_CONFLICT",
      "Media upload idempotency payload mismatch",
    );
  }
}

async function continueFromExistingUploadRow(
  db: Database,
  input: UploadMediaInput,
  existing: typeof mediaObjects.$inferSelect,
  payloadHash: string,
  declaredMime: AllowedMediaMime,
  detected: AllowedMediaMime,
): Promise<{ media: MediaObjectDto; idempotentReplay: boolean }> {
  assertPayloadHash(existing, payloadHash);
  if (existing.studentId !== input.studentId) {
    throw new FamilyContentError(
      "IDEMPOTENCY_CONFLICT",
      "Media upload idempotency payload mismatch",
    );
  }
  if (existing.status === "ready") {
    return { media: toMediaDto(existing), idempotentReplay: true };
  }
  if (
    existing.status === "rejected" ||
    existing.status === "revoked" ||
    existing.status === "purged" ||
    existing.status === "purging"
  ) {
    throw new FamilyContentError("MEDIA_REJECTED", "Media upload previously rejected");
  }
  // staging | processing — resume; never treat as successful replay.
  const resumed = await runUploadPipeline(db, input, existing, declaredMime, detected);
  return { media: resumed, idempotentReplay: false };
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

/** Transient infra failures stay recoverable under staging/processing. */
async function markRecoverableFailure(
  db: Database,
  mediaId: string,
  status: "staging" | "processing",
  category: string,
  now: Date,
): Promise<void> {
  await db
    .update(mediaObjects)
    .set({
      status,
      scanResult: "error",
      scanErrorCategory: category,
      updatedAt: now,
    })
    .where(
      and(
        eq(mediaObjects.id, mediaId),
        sql`${mediaObjects.status} IN ('staging', 'processing')`,
      ),
    );
}

async function finalizeReadyInShortTx(
  db: Database,
  input: {
    mediaId: string;
    actorId: string;
    studentId: string;
    idempotencyKey: string;
    requestId?: string;
    declaredMime: string;
    reencoded: {
      mime: string;
      sha256: string;
      bytes: Buffer;
      width: number;
      height: number;
    };
    safeKey: string;
    byteSize: number;
    now: Date;
  },
): Promise<typeof mediaObjects.$inferSelect> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM media_objects WHERE id = ${input.mediaId}::uuid FOR UPDATE`);
    const [current] = await tx
      .select()
      .from(mediaObjects)
      .where(eq(mediaObjects.id, input.mediaId))
      .limit(1);

    if (!current) {
      throw new FamilyContentError("MEDIA_UNAVAILABLE", "Media object missing during finalize");
    }

    if (current.status === "ready") {
      return current;
    }

    if (current.status !== "staging" && current.status !== "processing") {
      throw new FamilyContentError("MEDIA_REJECTED", "Media is not recoverable for finalize");
    }

    const [ready] = await tx
      .update(mediaObjects)
      .set({
        status: "ready",
        scanResult: "clean",
        scanErrorCategory: null,
        detectedMime: input.reencoded.mime,
        contentSha256: input.reencoded.sha256,
        safeByteSize: input.reencoded.bytes.length,
        width: input.reencoded.width,
        height: input.reencoded.height,
        safeObjectKey: input.safeKey,
        readyAt: input.now,
        updatedAt: input.now,
      })
      .where(eq(mediaObjects.id, input.mediaId))
      .returning();

    await appendAuditEvent(tx, {
      actorId: input.actorId,
      action: "media.uploaded",
      resourceType: "media_object",
      resourceId: input.mediaId,
      requestId: input.requestId ?? null,
      idempotencyKey: `audit:media-upload:${input.idempotencyKey}`,
      metadata: {
        studentId: input.studentId,
        status: "ready",
        declaredMime: input.declaredMime,
        detectedMime: input.reencoded.mime,
        byteSize: input.byteSize,
        safeByteSize: input.reencoded.bytes.length,
        width: input.reencoded.width,
        height: input.reencoded.height,
      },
    });

    return ready!;
  });
}

async function runUploadPipeline(
  db: Database,
  input: UploadMediaInput,
  media: typeof mediaObjects.$inferSelect,
  declaredMime: AllowedMediaMime,
  detected: AllowedMediaMime,
): Promise<MediaObjectDto> {
  const stagingKey = media.stagingObjectKey;
  const safeKey = `safe/${input.studentId}/${media.id}`;

  try {
    await input.mediaStore.putStaging(stagingKey, input.bytes);
  } catch {
    await markRecoverableFailure(
      db,
      media.id,
      "staging",
      "staging_write_failed",
      new Date(),
    );
    throw new FamilyContentError("MEDIA_UNAVAILABLE", "Failed to store staging object");
  }

  await db
    .update(mediaObjects)
    .set({ status: "processing", updatedAt: new Date(), scanErrorCategory: null })
    .where(
      and(
        eq(mediaObjects.id, media.id),
        sql`${mediaObjects.status} IN ('staging', 'processing')`,
      ),
    );

  const scan = await input.scanner.scan(input.bytes, declaredMime);
  if (scan.outcome === "rejected") {
    await markRejected(
      db,
      input.mediaStore,
      media.id,
      stagingKey,
      "rejected",
      scan.category,
      new Date(),
    );
    throw new FamilyContentError("MEDIA_REJECTED", "Media scan rejected upload");
  }
  if (scan.outcome === "error") {
    await markRecoverableFailure(
      db,
      media.id,
      "processing",
      scan.category,
      new Date(),
    );
    throw new FamilyContentError("MEDIA_UNAVAILABLE", "Media scan temporarily unavailable");
  }

  let reencoded;
  try {
    reencoded = await reencodeSafeImage(input.bytes, detected);
  } catch (error) {
    await markRejected(
      db,
      input.mediaStore,
      media.id,
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
    await markRecoverableFailure(db, media.id, "processing", "promote_failed", new Date());
    throw new FamilyContentError("MEDIA_UNAVAILABLE", "Failed to promote safe object");
  }

  // Promote succeeded: finalize must converge via short TX (ready + audit). On failure,
  // identical key+payload retries re-enter processing and re-finalize without leaving
  // an untracked safe object (promote is idempotent overwrite).
  try {
    const ready = await finalizeReadyInShortTx(db, {
      mediaId: media.id,
      actorId: input.actorId,
      studentId: input.studentId,
      idempotencyKey: input.idempotencyKey,
      requestId: input.requestId,
      declaredMime,
      reencoded,
      safeKey,
      byteSize: input.bytes.length,
      now: new Date(),
    });
    return toMediaDto(ready);
  } catch (error) {
    // Leave status as processing so idempotent replay can compensate finalize.
    if (error instanceof FamilyContentError) {
      throw error;
    }
    throw new FamilyContentError("MEDIA_UNAVAILABLE", "Failed to finalize ready media");
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
  // Lock-free: input validation and pure computation only. All DB work uses lockedDb.
  void db;
  assertUploadSize(input.bytes.length);
  const declaredMime = normalizeDeclaredMime(input.declaredMime);
  const contentSha = createHash("sha256").update(input.bytes).digest("hex");
  const payloadHash = hashIdempotencyPayload({
    studentId: input.studentId,
    declaredMime,
    contentSha256: contentSha,
    byteSize: input.bytes.length,
  });

  const detected = detectImageMimeFromMagic(input.bytes);
  if (!detected) {
    throw new FamilyContentError("VALIDATION_ERROR", "Unrecognized image format");
  }
  assertDeclaredMatchesDetected(declaredMime, detected);

  return input.idempotencyLock.withLock(
    input.actorId,
    input.idempotencyKey,
    async (lockedDb) => {
      await assertUploaderMayUploadForStudent(
        lockedDb,
        input.actorId,
        input.studentId,
      );

      const existing = await findExistingUpload(
        lockedDb,
        input.actorId,
        input.idempotencyKey,
      );
      if (existing) {
        return continueFromExistingUploadRow(
          lockedDb,
          input,
          existing,
          payloadHash,
          declaredMime,
          detected,
        );
      }

      const now = input.now ?? new Date();
      const mediaId = randomUUID();
      const stagingKey = `staging/${input.studentId}/${mediaId}`;

      const inserted = await lockedDb.transaction(async (tx) => {
        const raced = await findExistingUpload(tx, input.actorId, input.idempotencyKey);
        if (raced) {
          assertPayloadHash(raced, payloadHash);
          return { kind: "existing" as const, row: raced };
        }

        await assertUploaderMayUploadForStudent(tx, input.actorId, input.studentId);

        const [row] = await tx
          .insert(mediaObjects)
          .values({
            id: mediaId,
            studentId: input.studentId,
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
          const again = await findExistingUpload(tx, input.actorId, input.idempotencyKey);
          if (again) {
            assertPayloadHash(again, payloadHash);
            return { kind: "existing" as const, row: again };
          }
          throw new FamilyContentError(
            "IDEMPOTENCY_CONFLICT",
            "Media upload idempotency payload mismatch",
          );
        }

        return { kind: "created" as const, row };
      });

      if (inserted.kind === "existing") {
        return continueFromExistingUploadRow(
          lockedDb,
          input,
          inserted.row,
          payloadHash,
          declaredMime,
          detected,
        );
      }

      const ready = await runUploadPipeline(
        lockedDb,
        input,
        inserted.row,
        declaredMime,
        detected,
      );
      return { media: ready, idempotentReplay: false };
    },
  );
}

export async function assertMediaReadyForAttach(
  db: Database,
  mediaId: string,
  actorId: string,
): Promise<typeof mediaObjects.$inferSelect> {
  await db.execute(sql`SELECT id FROM media_objects WHERE id = ${mediaId}::uuid FOR UPDATE`);
  const [media] = await db.select().from(mediaObjects).where(eq(mediaObjects.id, mediaId)).limit(1);
  if (!media || media.status !== "ready" || media.revokedAt) {
    throw new FamilyContentError("NOT_FOUND", "Media not found");
  }
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
    throw new FamilyContentError("FORBIDDEN", "Access denied");
  }
  if (media.studentId !== studentId) {
    throw new FamilyContentError("FORBIDDEN", "Access denied");
  }
  if (actorId !== studentId) {
    if (!(await hasActiveRelationship(db, actorId, studentId))) {
      throw new FamilyContentError("FORBIDDEN", "Access denied");
    }
  }
  return media;
}
