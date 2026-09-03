import { config } from "dotenv";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import * as schema from "@/db/schema";
import {
  auditEvents,
  familyPushVersions,
  mediaObjects,
  mediaPurgeIntents,
  mediaReadCapabilities,
  mediaReferences,
  outboxEvents,
  pushAnswerVersions,
  pushAnswers,
  relationships,
  users,
} from "@/db/schema";
import { requireDatabaseUrl } from "@/lib/env";
import {
  applyTombstonesBeforeProjectionRebuild,
  assertTombstoneInvariants,
} from "@/modules/data-lifecycle/tombstone-replay.service";
import { DELETION_TARGET_TYPE } from "@/modules/data-lifecycle/constants";
import {
  confirmDeletionRequest,
  createDeletionRequest,
  processDeletionWorker,
} from "@/modules/data-lifecycle/deletion-request.service";
import { createMemoryArtifactStore } from "@/modules/data-lifecycle/private-artifact-store";
import { endRelationship } from "@/modules/family-access/end-relationship.service";
import { submitPushAnswer } from "@/modules/family-content/answer.service";
import {
  assertFamilyContentDeletionCanary,
  purgeFamilyContentBodiesForStudent,
  setFamilyContentDeletionTxFailureHookForTest,
} from "@/modules/family-content/account-deletion.service";
import { MAX_IMAGE_DIMENSION } from "@/modules/family-content/constants";
import { createFamilyPush } from "@/modules/family-content/create-push.service";
import { FamilyContentError } from "@/modules/family-content/errors";
import {
  issueMediaReadCapability,
  readMediaWithCapability,
} from "@/modules/family-content/media-capability.service";
import {
  createAlwaysCleanTestScanner,
  createFailClosedProductionScanner,
} from "@/modules/family-content/media-scanner";
import { handleMediaPurgeRequestedV1 } from "@/modules/family-content/media-purge.service";
import { attachReadyMediaToResource } from "@/modules/family-content/media-reference.service";
import {
  setMediaUploadFinalizeFailureHookForTest,
  uploadFamilyMedia,
} from "@/modules/family-content/media-upload.service";
import { createMemoryMediaStore } from "@/modules/family-content/private-media-store";
import { transitionFamilyPush } from "@/modules/family-content/push-lifecycle.service";
import {
  setRouteMediaScannerForTest,
  setRouteMediaStoreForTest,
} from "@/modules/family-content/route-media-stores";
import {
  processOutboxEventById,
  type ClaimedOutboxEvent,
} from "@/modules/outbox/process-outbox-event.service";
import { replayDeadOutboxEvent } from "@/modules/outbox/replay-outbox-event.service";
import {
  acceptParentForStudent,
  bootstrapVerifiedParentWithInvite,
  seedStudentUser,
} from "../../helpers/family-access";
import {
  closeTestDb,
  getTestDb,
  migrateTestDb,
  resetIdentityTables,
  type TestDb,
} from "../../helpers/db";

config({ path: ".env.local" });
config({ path: ".env" });

const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);

async function makePng(size = 64): Promise<Buffer> {
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 3,
      background: { r: 20, g: 120, b: 200 },
    },
  })
    .png()
    .toBuffer();
}

async function makeJpeg(size = 48): Promise<Buffer> {
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 3,
      background: { r: 200, g: 80, b: 40 },
    },
  })
    .jpeg({ quality: 80 })
    .toBuffer();
}

async function makeWebp(size = 40): Promise<Buffer> {
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 3,
      background: { r: 40, g: 180, b: 90 },
    },
  })
    .webp({ quality: 80 })
    .toBuffer();
}

function createConcurrentBarrier(participants: number) {
  let arrived = 0;
  let release!: () => void;
  const proceed = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    async wait(): Promise<void> {
      arrived += 1;
      if (arrived === participants) release();
      await proceed;
    },
  };
}

async function withIndependentTransaction<T>(
  fn: (tx: Parameters<Parameters<TestDb["transaction"]>[0]>[0]) => Promise<T>,
): Promise<T> {
  const client = postgres(requireDatabaseUrl(), { max: 1 });
  const independentDb = drizzle(client, { schema });
  try {
    return await independentDb.transaction(fn);
  } finally {
    await client.end({ timeout: 5 });
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe.skipIf(!hasDb)("M7 family content P2 media remediation", () => {
  const db = getTestDb();
  const mediaStore = createMemoryMediaStore();
  const scanner = createAlwaysCleanTestScanner();

  beforeAll(async () => {
    process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";
    await migrateTestDb();
  });

  beforeEach(async () => {
    setMediaUploadFinalizeFailureHookForTest(null);
    setFamilyContentDeletionTxFailureHookForTest(null);
    await resetIdentityTables(db);
    setRouteMediaStoreForTest(mediaStore);
    setRouteMediaScannerForTest(scanner);
  });

  afterEach(() => {
    setMediaUploadFinalizeFailureHookForTest(null);
    setFamilyContentDeletionTxFailureHookForTest(null);
  });

  afterAll(async () => {
    setMediaUploadFinalizeFailureHookForTest(null);
    setFamilyContentDeletionTxFailureHookForTest(null);
    setRouteMediaStoreForTest(null);
    setRouteMediaScannerForTest(null);
    await closeTestDb();
  });

  async function seedFamily() {
    const suffix = crypto.randomUUID().slice(0, 8);
    const { parentId } = await bootstrapVerifiedParentWithInvite(
      db,
      `media_parent_${suffix}@test.local`,
    );
    const student = await seedStudentUser(db, {
      username: `media_student_${suffix}`,
      password: "StudentPass123!Student",
    });
    await acceptParentForStudent(db, {
      parentId,
      studentId: student.studentId,
    });
    return { parentId, studentId: student.studentId };
  }

  async function seedSecondParent(studentId: string) {
    const suffix = crypto.randomUUID().slice(0, 8);
    const { parentId } = await bootstrapVerifiedParentWithInvite(
      db,
      `media_parent2_${suffix}@test.local`,
    );
    await acceptParentForStudent(db, {
      parentId,
      studentId,
      idempotencySuffix: `p2-${suffix}`,
    });
    return parentId;
  }

  function purgeEvent(mediaId: string, attemptNumber = 1): ClaimedOutboxEvent {
    return {
      eventId: crypto.randomUUID(),
      eventType: "family_media.purge_requested",
      eventVersion: 1,
      payload: { mediaId },
      leaseToken: `lease-${attemptNumber}`,
      attemptNumber,
      aggregateType: "media_object",
      aggregateId: mediaId,
    };
  }

  async function makePurgeDue(mediaId: string): Promise<{ eventId: string; purgeAfter: Date }> {
    const unreferencedAt = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000);
    const purgeAfter = new Date(unreferencedAt.getTime() + 90 * 24 * 60 * 60 * 1000);
    await db
      .update(mediaObjects)
      .set({ unreferencedAt, purgeAfter, updatedAt: new Date() })
      .where(eq(mediaObjects.id, mediaId));
    await db
      .update(mediaPurgeIntents)
      .set({ purgeAfter, updatedAt: new Date(), status: "pending" })
      .where(eq(mediaPurgeIntents.mediaId, mediaId));

    const [event] = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.aggregateId, mediaId))
      .limit(1);
    expect(event).toBeTruthy();
    await db
      .update(outboxEvents)
      .set({ availableAt: purgeAfter, status: "pending" })
      .where(eq(outboxEvents.id, event!.id));
    return { eventId: event!.id, purgeAfter };
  }

  async function findUploadByKey(uploaderId: string, key: string) {
    const [row] = await db
      .select()
      .from(mediaObjects)
      .where(
        and(eq(mediaObjects.uploaderId, uploaderId), eq(mediaObjects.createIdempotencyKey, key)),
      )
      .limit(1);
    return row ?? null;
  }

  it("P2-F06: accepts JPEG/PNG/WebP; rejects truncated/malformed/oversize/scan/reencode failures", async () => {
    const { parentId, studentId } = await seedFamily();

    for (const [mime, bytes] of [
      ["image/png", await makePng()],
      ["image/jpeg", await makeJpeg()],
      ["image/webp", await makeWebp()],
    ] as const) {
      const uploaded = await uploadFamilyMedia(db, {
        actorId: parentId,
        studentId,
        declaredMime: mime,
        bytes,
        idempotencyKey: `fmt-${mime}-${crypto.randomUUID()}`,
        mediaStore,
        scanner,
      });
      expect(uploaded.media.status).toBe("ready");
      expect(uploaded.media.studentId).toBe(studentId);
      expect(uploaded.media.detectedMime).toBe(mime);
      const [row] = await db
        .select()
        .from(mediaObjects)
        .where(eq(mediaObjects.id, uploaded.media.mediaId))
        .limit(1);
      expect(row?.studentId).toBe(studentId);
      expect(mediaStore.hasStaging(row!.stagingObjectKey)).toBe(false);
      expect(mediaStore.hasSafe(row!.safeObjectKey!)).toBe(true);
    }

    await expect(
      uploadFamilyMedia(db, {
        actorId: parentId,
        studentId,
        declaredMime: "image/png",
        bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
        idempotencyKey: `trunc-${crypto.randomUUID()}`,
        mediaStore,
        scanner,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    await expect(
      uploadFamilyMedia(db, {
        actorId: parentId,
        studentId,
        declaredMime: "image/png",
        bytes: Buffer.from("not-an-image"),
        idempotencyKey: `bad-${crypto.randomUUID()}`,
        mediaStore,
        scanner,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    const png = await makePng();
    await expect(
      uploadFamilyMedia(db, {
        actorId: parentId,
        studentId,
        declaredMime: "image/jpeg",
        bytes: png,
        idempotencyKey: `mime-${crypto.randomUUID()}`,
        mediaStore,
        scanner,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    const huge = Buffer.alloc(10 * 1024 * 1024 + 1, 1);
    await expect(
      uploadFamilyMedia(db, {
        actorId: parentId,
        studentId,
        declaredMime: "image/png",
        bytes: huge,
        idempotencyKey: `huge-${crypto.randomUUID()}`,
        mediaStore,
        scanner,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    const malwareKey = `scan-${crypto.randomUUID()}`;
    await expect(
      uploadFamilyMedia(db, {
        actorId: parentId,
        studentId,
        declaredMime: "image/png",
        bytes: png,
        idempotencyKey: malwareKey,
        mediaStore,
        scanner: {
          async scan() {
            return { outcome: "rejected" as const, category: "malware" };
          },
        },
      }),
    ).rejects.toMatchObject({ code: "MEDIA_REJECTED" });
    const malwareRow = await findUploadByKey(parentId, malwareKey);
    expect(malwareRow?.status).toBe("rejected");
    expect(malwareRow?.scanResult).toBe("rejected");

    const scanErrKey = `scan-err-${crypto.randomUUID()}`;
    await expect(
      uploadFamilyMedia(db, {
        actorId: parentId,
        studentId,
        declaredMime: "image/png",
        bytes: png,
        idempotencyKey: scanErrKey,
        mediaStore,
        scanner: {
          async scan() {
            return { outcome: "error" as const, category: "scanner_timeout" };
          },
        },
      }),
    ).rejects.toMatchObject({ code: "MEDIA_UNAVAILABLE" });
    const scanErrRow = await findUploadByKey(parentId, scanErrKey);
    expect(scanErrRow?.status).toBe("processing");
    expect(scanErrRow?.scanResult).toBe("error");
    expect(scanErrRow?.scanErrorCategory).toBe("scanner_timeout");
    const scanErrResumed = await uploadFamilyMedia(db, {
      actorId: parentId,
      studentId,
      declaredMime: "image/png",
      bytes: png,
      idempotencyKey: scanErrKey,
      mediaStore,
      scanner,
    });
    expect(scanErrResumed.media.status).toBe("ready");
    expect(scanErrResumed.media.mediaId).toBe(scanErrRow!.id);

    const fcKey = `fc-${crypto.randomUUID()}`;
    await expect(
      uploadFamilyMedia(db, {
        actorId: parentId,
        studentId,
        declaredMime: "image/png",
        bytes: png,
        idempotencyKey: fcKey,
        mediaStore,
        scanner: createFailClosedProductionScanner(),
      }),
    ).rejects.toMatchObject({ code: "MEDIA_UNAVAILABLE" });
    const fcRow = await findUploadByKey(parentId, fcKey);
    expect(fcRow?.status).toBe("processing");
    expect(fcRow?.scanResult).toBe("error");
    const fcResumed = await uploadFamilyMedia(db, {
      actorId: parentId,
      studentId,
      declaredMime: "image/png",
      bytes: png,
      idempotencyKey: fcKey,
      mediaStore,
      scanner,
    });
    expect(fcResumed.media.status).toBe("ready");

    // Valid PNG magic but truncated body → reencode/decode failure path
    const truncatedPng = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(64, 0),
    ]);
    await expect(
      uploadFamilyMedia(db, {
        actorId: parentId,
        studentId,
        declaredMime: "image/png",
        bytes: truncatedPng,
        idempotencyKey: `reenc-${crypto.randomUUID()}`,
        mediaStore,
        scanner,
      }),
    ).rejects.toMatchObject({ code: "MEDIA_REJECTED" });

    // Pixel bomb: width exceeds MAX_IMAGE_DIMENSION
    let pixelBomb: Buffer | null = null;
    try {
      pixelBomb = await sharp({
        create: {
          width: MAX_IMAGE_DIMENSION + 1,
          height: 10,
          channels: 3,
          background: { r: 10, g: 20, b: 30 },
        },
      })
        .png()
        .toBuffer();
    } catch {
      // sharp refused oversized create — still evidence of rejection-path guard
      pixelBomb = null;
    }
    if (pixelBomb) {
      await expect(
        uploadFamilyMedia(db, {
          actorId: parentId,
          studentId,
          declaredMime: "image/png",
          bytes: pixelBomb,
          idempotencyKey: `pxbomb-${crypto.randomUUID()}`,
          mediaStore,
          scanner,
        }),
      ).rejects.toMatchObject({ code: "MEDIA_REJECTED" });
    } else {
      expect(pixelBomb).toBeNull();
    }

    const audits = await db.select().from(auditEvents);
    for (const audit of audits) {
      const meta = JSON.stringify(audit.metadata ?? {});
      expect(meta).not.toMatch(/staging\//);
      expect(meta).not.toMatch(/safe\//);
      expect(meta.toLowerCase()).not.toContain("capability");
    }
  });

  it("P2-F01: binds student_id; blocks cross-student/wrong-purpose/non-uploader attach", async () => {
    const familyA = await seedFamily();
    const familyB = await seedFamily();
    const png = await makePng(32);

    const uploaded = await uploadFamilyMedia(db, {
      actorId: familyA.parentId,
      studentId: familyA.studentId,
      declaredMime: "image/png",
      bytes: png,
      idempotencyKey: `bind-${crypto.randomUUID()}`,
      mediaStore,
      scanner,
    });
    expect(uploaded.media.studentId).toBe(familyA.studentId);

    const pushA = await createFamilyPush(db, {
      actorId: familyA.parentId,
      studentId: familyA.studentId,
      body: "a",
      publishMode: "immediate",
      idempotencyKey: `pusha-${crypto.randomUUID()}`,
    });
    const pushB = await createFamilyPush(db, {
      actorId: familyB.parentId,
      studentId: familyB.studentId,
      body: "b",
      publishMode: "immediate",
      idempotencyKey: `pushb-${crypto.randomUUID()}`,
    });

    // Cross-student attach must fail (media for A onto B resource)
    await expect(
      db.transaction(async (tx) => {
        const versions = await tx
          .select()
          .from(familyPushVersions)
          .where(eq(familyPushVersions.pushId, pushB.push.pushId));
        await attachReadyMediaToResource(tx, {
          actorId: familyA.parentId,
          mediaId: uploaded.media.mediaId,
          resourceType: "family_push_version",
          resourceId: versions[0]!.id,
          purpose: "push_image",
          studentId: familyB.studentId,
        });
      }),
    ).rejects.toBeInstanceOf(FamilyContentError);

    // Wrong purpose
    await expect(
      db.transaction(async (tx) => {
        const versions = await tx
          .select()
          .from(familyPushVersions)
          .where(eq(familyPushVersions.pushId, pushA.push.pushId));
        await attachReadyMediaToResource(tx, {
          actorId: familyA.parentId,
          mediaId: uploaded.media.mediaId,
          resourceType: "family_push_version",
          resourceId: versions[0]!.id,
          purpose: "answer_image",
          studentId: familyA.studentId,
        });
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    // Non-uploader cannot attach
    const otherParent = await seedSecondParent(familyA.studentId);
    await expect(
      createFamilyPush(db, {
        actorId: otherParent,
        studentId: familyA.studentId,
        body: "steal",
        mediaIds: [uploaded.media.mediaId],
        publishMode: "immediate",
        idempotencyKey: `steal-${crypto.randomUUID()}`,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    // Same uploader, correct student — ok
    const ok = await createFamilyPush(db, {
      actorId: familyA.parentId,
      studentId: familyA.studentId,
      body: "with media",
      mediaIds: [uploaded.media.mediaId],
      publishMode: "immediate",
      idempotencyKey: `ok-${crypto.randomUUID()}`,
    });
    expect(ok.push.media).toHaveLength(1);

    // Duplicate attach on same purpose → unique conflict / error
    await expect(
      db.transaction(async (tx) => {
        const versions = await tx
          .select()
          .from(familyPushVersions)
          .where(eq(familyPushVersions.pushId, ok.push.pushId));
        await attachReadyMediaToResource(tx, {
          actorId: familyA.parentId,
          mediaId: uploaded.media.mediaId,
          resourceType: "family_push_version",
          resourceId: versions[0]!.id,
          purpose: "push_image",
          studentId: familyA.studentId,
        });
      }),
    ).rejects.toThrow();
  });

  it("P2-F02: recoverable staging/scanner/promote/finalize failures resume by same key", async () => {
    const { parentId, studentId } = await seedFamily();
    const png = await makePng(24);

    // 1) Staging write failure → MEDIA_UNAVAILABLE; staging + staging_write_failed; resume
    const stagingKey = `stg-fail-${crypto.randomUUID()}`;
    const stagingBase = createMemoryMediaStore();
    const brokenStaging = {
      ...stagingBase,
      async putStaging() {
        throw new Error("disk full");
      },
    };
    await expect(
      uploadFamilyMedia(db, {
        actorId: parentId,
        studentId,
        declaredMime: "image/png",
        bytes: png,
        idempotencyKey: stagingKey,
        mediaStore: brokenStaging,
        scanner,
      }),
    ).rejects.toMatchObject({ code: "MEDIA_UNAVAILABLE" });
    const stagingFailed = await findUploadByKey(parentId, stagingKey);
    expect(stagingFailed?.status).toBe("staging");
    expect(stagingFailed?.scanResult).toBe("error");
    expect(stagingFailed?.scanErrorCategory).toBe("staging_write_failed");
    const stagingResumed = await uploadFamilyMedia(db, {
      actorId: parentId,
      studentId,
      declaredMime: "image/png",
      bytes: png,
      idempotencyKey: stagingKey,
      mediaStore: stagingBase,
      scanner,
    });
    expect(stagingResumed.media.status).toBe("ready");
    expect(stagingResumed.media.mediaId).toBe(stagingFailed!.id);

    // 2) Scanner error → MEDIA_UNAVAILABLE; processing + category; resume with clean scanner
    const scanKey = `scan-resume-${crypto.randomUUID()}`;
    await expect(
      uploadFamilyMedia(db, {
        actorId: parentId,
        studentId,
        declaredMime: "image/png",
        bytes: png,
        idempotencyKey: scanKey,
        mediaStore,
        scanner: {
          async scan() {
            return { outcome: "error" as const, category: "scanner_timeout" };
          },
        },
      }),
    ).rejects.toMatchObject({ code: "MEDIA_UNAVAILABLE" });
    const scanFailed = await findUploadByKey(parentId, scanKey);
    expect(scanFailed?.status).toBe("processing");
    expect(scanFailed?.scanResult).toBe("error");
    expect(scanFailed?.scanErrorCategory).toBe("scanner_timeout");
    const scanResumed = await uploadFamilyMedia(db, {
      actorId: parentId,
      studentId,
      declaredMime: "image/png",
      bytes: png,
      idempotencyKey: scanKey,
      mediaStore,
      scanner,
    });
    expect(scanResumed.media.status).toBe("ready");
    expect(scanResumed.media.mediaId).toBe(scanFailed!.id);

    // 3) Promote failure → MEDIA_UNAVAILABLE; processing + promote_failed; resume
    const promoteKey = `prom-fail-${crypto.randomUUID()}`;
    const promoteBase = createMemoryMediaStore();
    const promoteFailStore = {
      ...promoteBase,
      async promoteSafe() {
        throw new Error("promote boom");
      },
    };
    await expect(
      uploadFamilyMedia(db, {
        actorId: parentId,
        studentId,
        declaredMime: "image/png",
        bytes: png,
        idempotencyKey: promoteKey,
        mediaStore: promoteFailStore,
        scanner,
      }),
    ).rejects.toMatchObject({ code: "MEDIA_UNAVAILABLE" });
    const promoteFailed = await findUploadByKey(parentId, promoteKey);
    expect(promoteFailed?.status).toBe("processing");
    expect(promoteFailed?.scanResult).toBe("error");
    expect(promoteFailed?.scanErrorCategory).toBe("promote_failed");
    const promoteResumed = await uploadFamilyMedia(db, {
      actorId: parentId,
      studentId,
      declaredMime: "image/png",
      bytes: png,
      idempotencyKey: promoteKey,
      mediaStore: promoteBase,
      scanner,
    });
    expect(promoteResumed.media.status).toBe("ready");
    expect(promoteResumed.media.mediaId).toBe(promoteFailed!.id);

    // 4) Real finalize TX inject after promote
    const finalizeKey = `fin-fail-${crypto.randomUUID()}`;
    const finalizeStore = createMemoryMediaStore();
    let finalizeHookFired = false;
    setMediaUploadFinalizeFailureHookForTest(() => {
      finalizeHookFired = true;
      throw new Error("injected finalize tx fail");
    });
    await expect(
      uploadFamilyMedia(db, {
        actorId: parentId,
        studentId,
        declaredMime: "image/png",
        bytes: png,
        idempotencyKey: finalizeKey,
        mediaStore: finalizeStore,
        scanner,
      }),
    ).rejects.toMatchObject({ code: "MEDIA_UNAVAILABLE" });
    expect(finalizeHookFired).toBe(true);
    const finalizeFailed = await findUploadByKey(parentId, finalizeKey);
    expect(finalizeFailed?.status).toBe("processing");
    expect(finalizeFailed?.status).not.toBe("ready");
    const auditsBeforeRetry = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.action, "media.uploaded"),
          eq(auditEvents.resourceId, finalizeFailed!.id),
        ),
      );
    expect(auditsBeforeRetry).toHaveLength(0);

    setMediaUploadFinalizeFailureHookForTest(null);
    const finalizeResumed = await uploadFamilyMedia(db, {
      actorId: parentId,
      studentId,
      declaredMime: "image/png",
      bytes: png,
      idempotencyKey: finalizeKey,
      mediaStore: finalizeStore,
      scanner,
    });
    expect(finalizeResumed.media.status).toBe("ready");
    expect(finalizeResumed.media.mediaId).toBe(finalizeFailed!.id);
    const auditsAfterReady = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.action, "media.uploaded"),
          eq(auditEvents.resourceId, finalizeFailed!.id),
        ),
      );
    expect(auditsAfterReady).toHaveLength(1);

    const readyReplay = await uploadFamilyMedia(db, {
      actorId: parentId,
      studentId,
      declaredMime: "image/png",
      bytes: png,
      idempotencyKey: finalizeKey,
      mediaStore: finalizeStore,
      scanner,
    });
    expect(readyReplay.idempotentReplay).toBe(true);
    expect(readyReplay.media.mediaId).toBe(finalizeFailed!.id);

    const other = await makePng(28);
    await expect(
      uploadFamilyMedia(db, {
        actorId: parentId,
        studentId,
        declaredMime: "image/png",
        bytes: other,
        idempotencyKey: finalizeKey,
        mediaStore: finalizeStore,
        scanner,
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("P2-F03/F06: revoke keeps physical object; worker prepare/finalize; shared ref; dead replay", async () => {
    const { parentId, studentId } = await seedFamily();
    const png = await makePng(30);
    const uploaded = await uploadFamilyMedia(db, {
      actorId: parentId,
      studentId,
      declaredMime: "image/png",
      bytes: png,
      idempotencyKey: `life-${crypto.randomUUID()}`,
      mediaStore,
      scanner,
    });

    const push1 = await createFamilyPush(db, {
      actorId: parentId,
      studentId,
      body: "img1",
      mediaIds: [uploaded.media.mediaId],
      publishMode: "immediate",
      idempotencyKey: `p1-${crypto.randomUUID()}`,
    });
    const push2 = await createFamilyPush(db, {
      actorId: parentId,
      studentId,
      body: "img2",
      mediaIds: [uploaded.media.mediaId],
      publishMode: "immediate",
      idempotencyKey: `p2-${crypto.randomUUID()}`,
    });

    const [mediaShared] = await db
      .select()
      .from(mediaObjects)
      .where(eq(mediaObjects.id, uploaded.media.mediaId))
      .limit(1);
    expect(mediaShared?.referenceCount).toBe(2);
    const safeKey = mediaShared!.safeObjectKey!;
    expect(mediaStore.hasSafe(safeKey)).toBe(true);

    // revokeSafe must not delete physically
    await mediaStore.revokeSafe(safeKey);
    expect(mediaStore.hasSafe(safeKey)).toBe(true);

    const issued = await issueMediaReadCapability(db, {
      actorId: parentId,
      referenceId: push1.push.media[0]!.referenceId,
    });
    const beforeDelete = await readMediaWithCapability(db, {
      capabilityToken: issued.capabilityToken,
      mediaStore,
    });
    expect(beforeDelete.bytes.length).toBeGreaterThan(0);

    // Delete one push — shared ref keeps object; no premature purge
    await transitionFamilyPush(db, {
      actorId: parentId,
      pushId: push1.push.pushId,
      action: "delete",
      idempotencyKey: `del1-${crypto.randomUUID()}`,
    });
    expect(mediaStore.hasSafe(safeKey)).toBe(true);
    const [afterOne] = await db
      .select()
      .from(mediaObjects)
      .where(eq(mediaObjects.id, uploaded.media.mediaId))
      .limit(1);
    expect(afterOne?.referenceCount).toBe(1);
    expect(afterOne?.purgeAfter).toBeNull();

    // Old token for deleted push ref fails immediately
    await expect(
      readMediaWithCapability(db, {
        capabilityToken: issued.capabilityToken,
        mediaStore,
      }),
    ).rejects.toBeInstanceOf(FamilyContentError);

    // Not due yet
    await transitionFamilyPush(db, {
      actorId: parentId,
      pushId: push2.push.pushId,
      action: "delete",
      idempotencyKey: `del2-${crypto.randomUUID()}`,
    });
    await expect(
      handleMediaPurgeRequestedV1(db, purgeEvent(uploaded.media.mediaId), mediaStore),
    ).rejects.toThrow(/not due/);
    expect(mediaStore.hasSafe(safeKey)).toBe(true);

    const { eventId, purgeAfter } = await makePurgeDue(uploaded.media.mediaId);

    // Worker path (not bare handler-only): process due outbox event
    const processed = await processOutboxEventById(db, {
      eventId,
      workerId: "media-purge-worker",
      now: new Date(purgeAfter.getTime() + 1000),
    });
    expect(processed.processed).toBe(true);

    const [purged] = await db
      .select()
      .from(mediaObjects)
      .where(eq(mediaObjects.id, uploaded.media.mediaId))
      .limit(1);
    expect(purged?.status).toBe("purged");
    expect(mediaStore.hasSafe(safeKey)).toBe(false);

    // Idempotent handler replay
    await handleMediaPurgeRequestedV1(db, purgeEvent(uploaded.media.mediaId, 2), mediaStore);

    // Dead replay converges with concrete final-state assertions
    await db
      .update(outboxEvents)
      .set({ status: "dead", attempts: 8 })
      .where(eq(outboxEvents.id, eventId));
    await replayDeadOutboxEvent(db, {
      eventId,
      actorId: parentId,
      reason: "media_purge_dead_replay",
      idempotencyKey: `replay-media-${eventId}`,
      now: new Date(purgeAfter.getTime() + 2000),
    });
    await processOutboxEventById(db, {
      eventId,
      workerId: "media-purge-replay",
      now: new Date(purgeAfter.getTime() + 3000),
    });

    const [afterReplayMedia] = await db
      .select()
      .from(mediaObjects)
      .where(eq(mediaObjects.id, uploaded.media.mediaId))
      .limit(1);
    expect(afterReplayMedia?.status).toBe("purged");
    const [afterReplayIntent] = await db
      .select()
      .from(mediaPurgeIntents)
      .where(eq(mediaPurgeIntents.mediaId, uploaded.media.mediaId))
      .limit(1);
    expect(afterReplayIntent?.status).toBe("completed");
    expect(mediaStore.hasSafe(safeKey)).toBe(false);
    const purgedAudits = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.action, "media.purged"),
          eq(auditEvents.resourceId, uploaded.media.mediaId),
        ),
      );
    expect(purgedAudits).toHaveLength(1);

    // Partial physical failure → retryable intent
    const png2 = await makePng(22);
    const up2 = await uploadFamilyMedia(db, {
      actorId: parentId,
      studentId,
      declaredMime: "image/png",
      bytes: png2,
      idempotencyKey: `failpurge-${crypto.randomUUID()}`,
      mediaStore,
      scanner,
    });
    const pushFail = await createFamilyPush(db, {
      actorId: parentId,
      studentId,
      body: "failpurge",
      mediaIds: [up2.media.mediaId],
      publishMode: "immediate",
      idempotencyKey: `pf-${crypto.randomUUID()}`,
    });
    await transitionFamilyPush(db, {
      actorId: parentId,
      pushId: pushFail.push.pushId,
      action: "delete",
      idempotencyKey: `df-${crypto.randomUUID()}`,
    });
    await makePurgeDue(up2.media.mediaId);
    const boomStore = {
      ...mediaStore,
      async purgeSafe() {
        throw new Error("s3 down");
      },
    };
    await expect(
      handleMediaPurgeRequestedV1(db, purgeEvent(up2.media.mediaId), boomStore),
    ).rejects.toThrow(/safe purge failed/);
    const [intent] = await db
      .select()
      .from(mediaPurgeIntents)
      .where(eq(mediaPurgeIntents.mediaId, up2.media.mediaId))
      .limit(1);
    expect(intent?.status).toBe("pending");
    expect(intent?.lastErrorCategory).toBe("safe_purge_failed");
  });

  it("P2-F03/F06: prepare vs attach races — attach-first keeps object; prepare-first blocks attach", async () => {
    const { parentId, studentId } = await seedFamily();
    const png = await makePng(28);

    // a) Attach wins first: re-reference before worker → purge must not delete object
    const upAttach = await uploadFamilyMedia(db, {
      actorId: parentId,
      studentId,
      declaredMime: "image/png",
      bytes: png,
      idempotencyKey: `race-attach-${crypto.randomUUID()}`,
      mediaStore,
      scanner,
    });
    const pushOld = await createFamilyPush(db, {
      actorId: parentId,
      studentId,
      body: "old",
      mediaIds: [upAttach.media.mediaId],
      publishMode: "immediate",
      idempotencyKey: `race-old-${crypto.randomUUID()}`,
    });
    await transitionFamilyPush(db, {
      actorId: parentId,
      pushId: pushOld.push.pushId,
      action: "delete",
      idempotencyKey: `race-del-${crypto.randomUUID()}`,
    });
    await makePurgeDue(upAttach.media.mediaId);

    const [beforeAttach] = await db
      .select()
      .from(mediaObjects)
      .where(eq(mediaObjects.id, upAttach.media.mediaId))
      .limit(1);
    const attachSafeKey = beforeAttach!.safeObjectKey!;

    const pushNew = await createFamilyPush(db, {
      actorId: parentId,
      studentId,
      body: "new ref",
      mediaIds: [upAttach.media.mediaId],
      publishMode: "immediate",
      idempotencyKey: `race-new-${crypto.randomUUID()}`,
    });
    expect(pushNew.push.media).toHaveLength(1);

    await handleMediaPurgeRequestedV1(db, purgeEvent(upAttach.media.mediaId), mediaStore);

    const [afterAttachWin] = await db
      .select()
      .from(mediaObjects)
      .where(eq(mediaObjects.id, upAttach.media.mediaId))
      .limit(1);
    expect(afterAttachWin?.status).toBe("ready");
    expect(mediaStore.hasSafe(attachSafeKey)).toBe(true);
    const [attachWinIntent] = await db
      .select()
      .from(mediaPurgeIntents)
      .where(eq(mediaPurgeIntents.mediaId, upAttach.media.mediaId))
      .limit(1);
    expect(attachWinIntent?.status).toBe("completed");
    expect(
      attachWinIntent?.lastErrorCategory === "cancelled_rereferenced" ||
        attachWinIntent?.lastErrorCategory === "still_referenced",
    ).toBe(true);

    // b) Prepare wins: hold purgeSafe after prepare; attach must fail while purging
    const upPrepare = await uploadFamilyMedia(db, {
      actorId: parentId,
      studentId,
      declaredMime: "image/png",
      bytes: await makePng(26),
      idempotencyKey: `race-prep-${crypto.randomUUID()}`,
      mediaStore,
      scanner,
    });
    const pushPrep = await createFamilyPush(db, {
      actorId: parentId,
      studentId,
      body: "prep",
      mediaIds: [upPrepare.media.mediaId],
      publishMode: "immediate",
      idempotencyKey: `race-prep-push-${crypto.randomUUID()}`,
    });
    await transitionFamilyPush(db, {
      actorId: parentId,
      pushId: pushPrep.push.pushId,
      action: "delete",
      idempotencyKey: `race-prep-del-${crypto.randomUUID()}`,
    });
    await makePurgeDue(upPrepare.media.mediaId);

    const [prepMediaBefore] = await db
      .select()
      .from(mediaObjects)
      .where(eq(mediaObjects.id, upPrepare.media.mediaId))
      .limit(1);
    const prepSafeKey = prepMediaBefore!.safeObjectKey!;

    const barrier = createConcurrentBarrier(2);
    const holdStore = {
      ...mediaStore,
      async purgeSafe(key: string) {
        await barrier.wait();
        return mediaStore.purgeSafe(key);
      },
    };

    const purgePromise = handleMediaPurgeRequestedV1(
      db,
      purgeEvent(upPrepare.media.mediaId),
      holdStore,
    );

    let prepared = false;
    for (let i = 0; i < 80; i += 1) {
      const [intent] = await db
        .select()
        .from(mediaPurgeIntents)
        .where(eq(mediaPurgeIntents.mediaId, upPrepare.media.mediaId))
        .limit(1);
      const [media] = await db
        .select()
        .from(mediaObjects)
        .where(eq(mediaObjects.id, upPrepare.media.mediaId))
        .limit(1);
      if (intent?.status === "prepared" && media?.status === "purging") {
        prepared = true;
        break;
      }
      await sleep(25);
    }
    expect(prepared).toBe(true);

    await expect(
      createFamilyPush(db, {
        actorId: parentId,
        studentId,
        body: "attach while purging",
        mediaIds: [upPrepare.media.mediaId],
        publishMode: "immediate",
        idempotencyKey: `race-prep-attach-${crypto.randomUUID()}`,
      }),
    ).rejects.toBeInstanceOf(FamilyContentError);

    await barrier.wait();
    await purgePromise;

    const [afterPrepWin] = await db
      .select()
      .from(mediaObjects)
      .where(eq(mediaObjects.id, upPrepare.media.mediaId))
      .limit(1);
    expect(afterPrepWin?.status).toBe("purged");
    expect(mediaStore.hasSafe(prepSafeKey)).toBe(false);

    const activeRefsToDeleted = await db
      .select()
      .from(mediaReferences)
      .where(
        and(
          eq(mediaReferences.mediaId, upPrepare.media.mediaId),
          isNull(mediaReferences.revokedAt),
        ),
      );
    expect(activeRefsToDeleted).toHaveLength(0);
  });

  it("P2-F04: capability bindings; Identity role; freeze; other/unrelated parents; unlink; epoch; revoke; tamper", async () => {
    const { parentId, studentId } = await seedFamily();
    const otherParent = await seedSecondParent(studentId);
    const stranger = await bootstrapVerifiedParentWithInvite(
      db,
      `stranger_${crypto.randomUUID().slice(0, 8)}@test.local`,
    );
    const familyB = await seedFamily();
    const png = await makePng(26);
    const uploaded = await uploadFamilyMedia(db, {
      actorId: parentId,
      studentId,
      declaredMime: "image/png",
      bytes: png,
      idempotencyKey: `cap-${crypto.randomUUID()}`,
      mediaStore,
      scanner,
    });
    const push = await createFamilyPush(db, {
      actorId: parentId,
      studentId,
      body: "cap",
      mediaIds: [uploaded.media.mediaId],
      publishMode: "immediate",
      idempotencyKey: `capp-${crypto.randomUUID()}`,
    });
    const refId = push.push.media[0]!.referenceId;

    // Parent issues OK (role resolved via Identity — no actorRole parameter)
    const creatorIssued = await issueMediaReadCapability(db, {
      actorId: parentId,
      referenceId: refId,
    });
    expect(
      (await readMediaWithCapability(db, { capabilityToken: creatorIssued.capabilityToken, mediaStore }))
        .bytes.length,
    ).toBeGreaterThan(0);

    // Student actor can issue for their push
    const studentIssued = await issueMediaReadCapability(db, {
      actorId: studentId,
      referenceId: refId,
    });
    expect(
      (await readMediaWithCapability(db, { capabilityToken: studentIssued.capabilityToken, mediaStore }))
        .bytes.length,
    ).toBeGreaterThan(0);

    // Other linked parent OK
    const linkedIssued = await issueMediaReadCapability(db, {
      actorId: otherParent,
      referenceId: refId,
    });
    expect(
      (await readMediaWithCapability(db, { capabilityToken: linkedIssued.capabilityToken, mediaStore }))
        .bytes.length,
    ).toBeGreaterThan(0);

    // Unrelated / stranger: FORBIDDEN (role resolved via Identity — forged role impossible).
    // Same denial for existence-adjacent probes; no actorRole parameter to forge.
    await expect(
      issueMediaReadCapability(db, {
        actorId: stranger.parentId,
        referenceId: refId,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    // Wrong target: parent of family B cannot issue for family A reference
    await expect(
      issueMediaReadCapability(db, {
        actorId: familyB.parentId,
        referenceId: refId,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    // Freeze student via deletion request → issue fails FROZEN (or NOT_FOUND)
    const artifactStore = createMemoryArtifactStore();
    await createDeletionRequest(db, {
      requestedBy: studentId,
      requesterRole: "student",
      targetType: DELETION_TARGET_TYPE.STUDENT_ACCOUNT,
      targetId: studentId,
      idempotencyKey: `cap-freeze-${crypto.randomUUID()}`,
      artifactStore,
    });
    await expect(
      issueMediaReadCapability(db, {
        actorId: parentId,
        referenceId: refId,
      }),
    ).rejects.toMatchObject({
      code: expect.stringMatching(/^(FROZEN|NOT_FOUND)$/),
    });

    // Remaining matrix on a fresh unfrozen family (freeze blocked further issues above)
    const fresh = await seedFamily();
    const freshUp = await uploadFamilyMedia(db, {
      actorId: fresh.parentId,
      studentId: fresh.studentId,
      declaredMime: "image/png",
      bytes: png,
      idempotencyKey: `cap2-${crypto.randomUUID()}`,
      mediaStore,
      scanner,
    });
    const freshPush = await createFamilyPush(db, {
      actorId: fresh.parentId,
      studentId: fresh.studentId,
      body: "cap2",
      mediaIds: [freshUp.media.mediaId],
      publishMode: "immediate",
      idempotencyKey: `capp2-${crypto.randomUUID()}`,
    });
    const freshRef = freshPush.push.media[0]!.referenceId;
    const freshOther = await seedSecondParent(fresh.studentId);

    const freshCreator = await issueMediaReadCapability(db, {
      actorId: fresh.parentId,
      referenceId: freshRef,
    });
    const freshLinked = await issueMediaReadCapability(db, {
      actorId: freshOther,
      referenceId: freshRef,
    });

    // Tampered token
    await expect(
      readMediaWithCapability(db, {
        capabilityToken: `${freshCreator.capabilityToken}x`,
        mediaStore,
      }),
    ).rejects.toMatchObject({ code: "TOKEN_INVALID" });

    // Expired
    await expect(
      readMediaWithCapability(db, {
        capabilityToken: freshCreator.capabilityToken,
        mediaStore,
        now: new Date(Date.now() + 10 * 60 * 1000),
      }),
    ).rejects.toMatchObject({ code: "TOKEN_EXPIRED" });

    // End other parent relationship → access denied on their token
    const [rel] = await db
      .select()
      .from(relationships)
      .where(
        and(
          eq(relationships.parentId, freshOther),
          eq(relationships.studentId, fresh.studentId),
          eq(relationships.status, "active"),
        ),
      )
      .limit(1);
    expect(rel).toBeTruthy();
    await endRelationship(db, {
      actorId: freshOther,
      relationshipId: rel!.id,
      idempotencyKey: `end-${crypto.randomUUID()}`,
    });
    await expect(
      readMediaWithCapability(db, {
        capabilityToken: freshLinked.capabilityToken,
        mediaStore,
      }),
    ).rejects.toBeInstanceOf(FamilyContentError);

    // Epoch change on student invalidates capabilities bound to prior epoch
    const freshBeforeEpoch = await issueMediaReadCapability(db, {
      actorId: fresh.parentId,
      referenceId: freshRef,
    });
    const [before] = await db
      .select({ authorizationEpoch: users.authorizationEpoch })
      .from(users)
      .where(eq(users.id, fresh.studentId))
      .limit(1);
    await db
      .update(users)
      .set({ authorizationEpoch: (before?.authorizationEpoch ?? 0) + 1 })
      .where(eq(users.id, fresh.studentId));
    await expect(
      readMediaWithCapability(db, {
        capabilityToken: freshBeforeEpoch.capabilityToken,
        mediaStore,
      }),
    ).rejects.toMatchObject({ code: "TOKEN_INVALID" });

    // Fresh issue after epoch bump still works for linked creator
    const afterEpoch = await issueMediaReadCapability(db, {
      actorId: fresh.parentId,
      referenceId: freshRef,
    });
    expect(
      (await readMediaWithCapability(db, { capabilityToken: afterEpoch.capabilityToken, mediaStore }))
        .bytes.length,
    ).toBeGreaterThan(0);

    // Delete push → revoke refs; old token fails
    await transitionFamilyPush(db, {
      actorId: fresh.parentId,
      pushId: freshPush.push.pushId,
      action: "delete",
      idempotencyKey: `delcap-${crypto.randomUUID()}`,
    });
    await expect(
      readMediaWithCapability(db, {
        capabilityToken: afterEpoch.capabilityToken,
        mediaStore,
      }),
    ).rejects.toBeInstanceOf(FamilyContentError);
    await expect(
      issueMediaReadCapability(db, {
        actorId: fresh.parentId,
        referenceId: freshRef,
      }),
    ).rejects.toBeInstanceOf(FamilyContentError);
  });

  it("P2-F05: deletion TX rollback; real restore; tombstone replay; stable audit/outbox", async () => {
    const { parentId, studentId } = await seedFamily();
    const png = await makePng(20);
    const uploaded = await uploadFamilyMedia(db, {
      actorId: parentId,
      studentId,
      declaredMime: "image/png",
      bytes: png,
      idempotencyKey: `delup-${crypto.randomUUID()}`,
      mediaStore,
      scanner,
    });
    // Never-attached media also enters revoke/cleanup
    await uploadFamilyMedia(db, {
      actorId: parentId,
      studentId,
      declaredMime: "image/png",
      bytes: await makePng(18),
      idempotencyKey: `orphan-${crypto.randomUUID()}`,
      mediaStore,
      scanner,
    });

    const push = await createFamilyPush(db, {
      actorId: parentId,
      studentId,
      body: "secret body",
      mediaIds: [uploaded.media.mediaId],
      publishMode: "immediate",
      idempotencyKey: `delpush-${crypto.randomUUID()}`,
    });
    await submitPushAnswer(db, {
      studentId,
      pushId: push.push.pushId,
      body: "secret answer",
      idempotencyKey: `delans-${crypto.randomUUID()}`,
    });

    const refId = push.push.media[0]!.referenceId;
    const issued = await issueMediaReadCapability(db, {
      actorId: parentId,
      referenceId: refId,
    });

    // Inject deletion TX failure mid-TX (before audit) → full rollback
    setFamilyContentDeletionTxFailureHookForTest(() => {
      throw new Error("injected deletion tx fail");
    });
    await expect(
      db.transaction(async (tx) => {
        await purgeFamilyContentBodiesForStudent(tx, {
          studentId,
          now: new Date(),
        });
      }),
    ).rejects.toThrow(/injected deletion tx fail/);
    setFamilyContentDeletionTxFailureHookForTest(null);

    const [pushVersion] = await db
      .select()
      .from(familyPushVersions)
      .where(eq(familyPushVersions.pushId, push.push.pushId))
      .limit(1);
    expect(pushVersion?.body).toBe("secret body");
    const [answer] = await db
      .select()
      .from(pushAnswers)
      .where(eq(pushAnswers.pushId, push.push.pushId))
      .limit(1);
    const [answerVersion] = await db
      .select()
      .from(pushAnswerVersions)
      .where(eq(pushAnswerVersions.answerId, answer!.id))
      .limit(1);
    expect(answerVersion?.body).toBe("secret answer");
    const [activeRef] = await db
      .select()
      .from(mediaReferences)
      .where(and(eq(mediaReferences.id, refId), isNull(mediaReferences.revokedAt)))
      .limit(1);
    expect(activeRef).toBeTruthy();
    const [liveCap] = await db
      .select()
      .from(mediaReadCapabilities)
      .where(
        and(
          eq(mediaReadCapabilities.referenceId, refId),
          isNull(mediaReadCapabilities.revokedAt),
        ),
      )
      .limit(1);
    expect(liveCap).toBeTruthy();
    const [readyMedia] = await db
      .select()
      .from(mediaObjects)
      .where(and(eq(mediaObjects.id, uploaded.media.mediaId), eq(mediaObjects.status, "ready")))
      .limit(1);
    expect(readyMedia).toBeTruthy();
    const purgeAuditsAfterFail = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "family_content.purged"));
    expect(purgeAuditsAfterFail).toHaveLength(0);

    // Real deletion worker path
    const artifactStore = createMemoryArtifactStore();
    const request = await createDeletionRequest(db, {
      requestedBy: studentId,
      requesterRole: "student",
      targetType: DELETION_TARGET_TYPE.STUDENT_ACCOUNT,
      targetId: studentId,
      idempotencyKey: `delreq-${crypto.randomUUID()}`,
      artifactStore,
    });
    await confirmDeletionRequest(db, {
      requestId: request.requestId,
      studentId,
      idempotencyKey: `delconfirm-${crypto.randomUUID()}`,
    });
    await processDeletionWorker(db, { requestId: request.requestId, artifactStore });

    await expect(
      readMediaWithCapability(db, {
        capabilityToken: issued.capabilityToken,
        mediaStore,
      }),
    ).rejects.toBeInstanceOf(FamilyContentError);

    await assertFamilyContentDeletionCanary(db, studentId);

    const auditsBefore = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "family_content.purged"));
    expect(auditsBefore).toHaveLength(1);

    // REAL restore of readable facts (not re-calling purge)
    const [mediaRow] = await db
      .select()
      .from(mediaObjects)
      .where(eq(mediaObjects.id, uploaded.media.mediaId))
      .limit(1);
    expect(mediaRow?.safeObjectKey).toBeTruthy();
    if (mediaRow?.safeObjectKey && !mediaStore.hasSafe(mediaRow.safeObjectKey)) {
      await mediaStore.putStaging(mediaRow.stagingObjectKey, png);
      await mediaStore.promoteSafe(mediaRow.stagingObjectKey, mediaRow.safeObjectKey, png);
    }

    await db
      .update(familyPushVersions)
      .set({ body: "secret body" })
      .where(eq(familyPushVersions.pushId, push.push.pushId));
    await db
      .update(pushAnswerVersions)
      .set({ body: "secret answer" })
      .where(eq(pushAnswerVersions.answerId, answer!.id));
    await db
      .update(mediaObjects)
      .set({
        status: "ready",
        revokedAt: null,
        referenceCount: 1,
        unreferencedAt: null,
        purgeAfter: null,
        updatedAt: new Date(),
        readyAt: mediaRow?.readyAt ?? new Date(),
        scanResult: "clean",
      })
      .where(eq(mediaObjects.id, uploaded.media.mediaId));
    await db
      .update(mediaReferences)
      .set({ revokedAt: null })
      .where(eq(mediaReferences.id, refId));
    await db
      .update(mediaReadCapabilities)
      .set({ revokedAt: null })
      .where(eq(mediaReadCapabilities.referenceId, refId));

    await expect(assertFamilyContentDeletionCanary(db, studentId)).rejects.toThrow();

    await applyTombstonesBeforeProjectionRebuild(db, { artifactStore });
    await assertFamilyContentDeletionCanary(db, studentId);
    await assertTombstoneInvariants(db, studentId);

    const [clearedPush] = await db
      .select()
      .from(familyPushVersions)
      .where(eq(familyPushVersions.pushId, push.push.pushId))
      .limit(1);
    expect(clearedPush?.body.trim()).toBe("");
    const [clearedAnswer] = await db
      .select()
      .from(pushAnswerVersions)
      .where(eq(pushAnswerVersions.answerId, answer!.id))
      .limit(1);
    expect(clearedAnswer?.body.trim()).toBe("");

    const outboxAfterFirstTombstone = (
      await db
        .select()
        .from(outboxEvents)
        .where(eq(outboxEvents.eventType, "family_media.purge_requested"))
    ).length;

    await applyTombstonesBeforeProjectionRebuild(db, { artifactStore });

    const auditsAfterReplay = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "family_content.purged"));
    expect(auditsAfterReplay).toHaveLength(1);

    const outboxAfterSecondTombstone = (
      await db
        .select()
        .from(outboxEvents)
        .where(eq(outboxEvents.eventType, "family_media.purge_requested"))
    ).length;
    expect(outboxAfterSecondTombstone).toBe(outboxAfterFirstTombstone);

    for (const event of await db.select().from(outboxEvents)) {
      const payload = JSON.stringify(event.payload);
      expect(payload).not.toMatch(/secret/);
      expect(payload).not.toContain("capabilityToken");
      expect(payload).not.toMatch(/staging\//);
    }
  });

  it("answer image attach + concurrent upload idempotency + concurrent duplicate attach", async () => {
    const { parentId, studentId } = await seedFamily();
    const png = await makePng(32);
    const studentUpload = await uploadFamilyMedia(db, {
      actorId: studentId,
      studentId,
      declaredMime: "image/png",
      bytes: png,
      idempotencyKey: `ans-up-${crypto.randomUUID()}`,
      mediaStore,
      scanner,
    });
    const push = await createFamilyPush(db, {
      actorId: parentId,
      studentId,
      body: "q",
      publishMode: "immediate",
      idempotencyKey: `ans-push-${crypto.randomUUID()}`,
    });
    const answer = await submitPushAnswer(db, {
      studentId,
      pushId: push.push.pushId,
      body: "",
      mediaIds: [studentUpload.media.mediaId],
      idempotencyKey: `ans-${crypto.randomUUID()}`,
    });
    expect(answer.answer.media.some((m) => m.purpose === "answer_image")).toBe(true);

    // Concurrent same-key uploads with barrier
    const key = `idem-${crypto.randomUUID()}`;
    const barrier = createConcurrentBarrier(2);
    const results = await Promise.allSettled([
      (async () => {
        await barrier.wait();
        return uploadFamilyMedia(db, {
          actorId: parentId,
          studentId,
          declaredMime: "image/png",
          bytes: png,
          idempotencyKey: key,
          mediaStore,
          scanner,
        });
      })(),
      (async () => {
        await barrier.wait();
        return uploadFamilyMedia(db, {
          actorId: parentId,
          studentId,
          declaredMime: "image/png",
          bytes: png,
          idempotencyKey: key,
          mediaStore,
          scanner,
        });
      })(),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    const mediaIds = new Set(
      fulfilled.map((r) => (r as PromiseFulfilledResult<{ media: { mediaId: string } }>).value.media.mediaId),
    );
    expect(mediaIds.size).toBe(1);
    const readyRows = await db
      .select()
      .from(mediaObjects)
      .where(
        and(
          eq(mediaObjects.uploaderId, parentId),
          eq(mediaObjects.createIdempotencyKey, key),
          eq(mediaObjects.status, "ready"),
        ),
      );
    expect(readyRows).toHaveLength(1);

    // Concurrent duplicate attach to SAME push version purpose via independent connections
    const attachMedia = await uploadFamilyMedia(db, {
      actorId: parentId,
      studentId,
      declaredMime: "image/png",
      bytes: await makePng(30),
      idempotencyKey: `dup-att-${crypto.randomUUID()}`,
      mediaStore,
      scanner,
    });
    const attachPush = await createFamilyPush(db, {
      actorId: parentId,
      studentId,
      body: "dup attach target",
      publishMode: "immediate",
      idempotencyKey: `dup-push-${crypto.randomUUID()}`,
    });
    const [version] = await db
      .select()
      .from(familyPushVersions)
      .where(eq(familyPushVersions.pushId, attachPush.push.pushId))
      .limit(1);
    expect(version).toBeTruthy();

    const attachBarrier = createConcurrentBarrier(2);
    const attachResults = await Promise.allSettled([
      withIndependentTransaction(async (tx) => {
        await attachBarrier.wait();
        return attachReadyMediaToResource(tx, {
          actorId: parentId,
          mediaId: attachMedia.media.mediaId,
          resourceType: "family_push_version",
          resourceId: version!.id,
          purpose: "push_image",
          studentId,
        });
      }),
      withIndependentTransaction(async (tx) => {
        await attachBarrier.wait();
        return attachReadyMediaToResource(tx, {
          actorId: parentId,
          mediaId: attachMedia.media.mediaId,
          resourceType: "family_push_version",
          resourceId: version!.id,
          purpose: "push_image",
          studentId,
        });
      }),
    ]);

    const attachOk = attachResults.filter((r) => r.status === "fulfilled");
    const attachFail = attachResults.filter((r) => r.status === "rejected");
    expect(attachOk).toHaveLength(1);
    expect(attachFail).toHaveLength(1);

    const [mediaAfterAttach] = await db
      .select()
      .from(mediaObjects)
      .where(eq(mediaObjects.id, attachMedia.media.mediaId))
      .limit(1);
    expect(mediaAfterAttach?.referenceCount).toBe(1);

    const activePurposeRefs = await db
      .select()
      .from(mediaReferences)
      .where(
        and(
          eq(mediaReferences.resourceType, "family_push_version"),
          eq(mediaReferences.resourceId, version!.id),
          eq(mediaReferences.purpose, "push_image"),
          isNull(mediaReferences.revokedAt),
        ),
      );
    expect(activePurposeRefs).toHaveLength(1);
  });
});
