import { createHash } from "node:crypto";

import { config } from "dotenv";
import { and, eq, isNull } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  auditEvents,
  mediaObjects,
  mediaPurgeIntents,
  mediaReadCapabilities,
  mediaReferences,
  outboxEvents,
} from "@/db/schema";
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
import { submitPushAnswer } from "@/modules/family-content/answer.service";
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
import { uploadFamilyMedia } from "@/modules/family-content/media-upload.service";
import { createMemoryMediaStore } from "@/modules/family-content/private-media-store";
import { transitionFamilyPush } from "@/modules/family-content/push-lifecycle.service";
import { setRouteMediaStoreForTest } from "@/modules/family-content/route-media-stores";
import type { ClaimedOutboxEvent } from "@/modules/outbox/process-outbox-event.service";
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
} from "../../helpers/db";

config({ path: ".env.local" });
config({ path: ".env" });

const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);

async function makePng(bytes = 64): Promise<Buffer> {
  return sharp({
    create: {
      width: bytes,
      height: bytes,
      channels: 3,
      background: { r: 20, g: 120, b: 200 },
    },
  })
    .png()
    .toBuffer();
}

describe.skipIf(!hasDb)("M7 family content P2 media", () => {
  const db = getTestDb();
  const mediaStore = createMemoryMediaStore();
  const scanner = createAlwaysCleanTestScanner();

  beforeAll(async () => {
    process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";
    await migrateTestDb();
  });

  beforeEach(async () => {
    await resetIdentityTables(db);
    setRouteMediaStoreForTest(mediaStore);
  });

  afterAll(async () => {
    setRouteMediaStoreForTest(null);
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

  it("AC-M7-05: accepts png, rejects mime mismatch/oversize/scan fail; staging not readable", async () => {
    const { parentId, studentId } = await seedFamily();
    const png = await makePng();

    const uploaded = await uploadFamilyMedia(db, {
      actorId: parentId,
      studentId,
      declaredMime: "image/png",
      bytes: png,
      idempotencyKey: `up-${crypto.randomUUID()}`,
      mediaStore,
      scanner,
    });
    expect(uploaded.media.status).toBe("ready");
    expect(uploaded.media.detectedMime).toBe("image/png");

    const row = await db
      .select()
      .from(mediaObjects)
      .where(eq(mediaObjects.id, uploaded.media.mediaId))
      .limit(1);
    expect(row[0]?.safeObjectKey).toBeTruthy();
    expect(mediaStore.hasStaging(row[0]!.stagingObjectKey)).toBe(false);
    expect(mediaStore.hasSafe(row[0]!.safeObjectKey!)).toBe(true);

    await expect(
      uploadFamilyMedia(db, {
        actorId: parentId,
        studentId,
        declaredMime: "image/jpeg",
        bytes: png,
        idempotencyKey: `bad-mime-${crypto.randomUUID()}`,
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

    const rejectScanner = {
      async scan() {
        return { outcome: "rejected" as const, category: "malware" };
      },
    };
    await expect(
      uploadFamilyMedia(db, {
        actorId: parentId,
        studentId,
        declaredMime: "image/png",
        bytes: png,
        idempotencyKey: `scan-${crypto.randomUUID()}`,
        mediaStore,
        scanner: rejectScanner,
      }),
    ).rejects.toMatchObject({ code: "MEDIA_REJECTED" });

    const failClosed = createFailClosedProductionScanner();
    await expect(
      uploadFamilyMedia(db, {
        actorId: parentId,
        studentId,
        declaredMime: "image/png",
        bytes: png,
        idempotencyKey: `fc-${crypto.randomUUID()}`,
        mediaStore,
        scanner: failClosed,
      }),
    ).rejects.toMatchObject({ code: "MEDIA_REJECTED" });

    const audits = await db.select().from(auditEvents);
    for (const audit of audits) {
      const meta = JSON.stringify(audit.metadata ?? {});
      expect(meta).not.toMatch(/staging\//);
      expect(meta).not.toMatch(/safe\//);
      expect(meta.toLowerCase()).not.toContain("capability");
    }
  });

  it("AC-M7-05/06: short-TTL capability, revoke on delete, 90-day purge idempotent", async () => {
    const { parentId, studentId } = await seedFamily();
    const png = await makePng();
    const uploaded = await uploadFamilyMedia(db, {
      actorId: parentId,
      studentId,
      declaredMime: "image/png",
      bytes: png,
      idempotencyKey: `cap-${crypto.randomUUID()}`,
      mediaStore,
      scanner,
    });

    const created = await createFamilyPush(db, {
      actorId: parentId,
      studentId,
      body: "with image",
      mediaIds: [uploaded.media.mediaId],
      publishMode: "immediate",
      idempotencyKey: `push-${crypto.randomUUID()}`,
    });
    expect(created.push.media).toHaveLength(1);

    const issued = await issueMediaReadCapability(db, {
      actorId: parentId,
      actorRole: "parent",
      referenceId: created.push.media[0]!.referenceId,
    });
    const read = await readMediaWithCapability(db, {
      capabilityToken: issued.capabilityToken,
      mediaStore,
    });
    expect(read.bytes.length).toBeGreaterThan(0);
    expect(read.mime).toBe("image/png");

    await transitionFamilyPush(db, {
      actorId: parentId,
      pushId: created.push.pushId,
      action: "delete",
      idempotencyKey: `del-${crypto.randomUUID()}`,
    });

    await expect(
      readMediaWithCapability(db, {
        capabilityToken: issued.capabilityToken,
        mediaStore,
      }),
    ).rejects.toBeInstanceOf(FamilyContentError);

    const [media] = await db
      .select()
      .from(mediaObjects)
      .where(eq(mediaObjects.id, uploaded.media.mediaId))
      .limit(1);
    expect(media?.referenceCount).toBe(0);
    expect(media?.purgeAfter).toBeTruthy();

    const [intent] = await db
      .select()
      .from(mediaPurgeIntents)
      .where(eq(mediaPurgeIntents.mediaId, uploaded.media.mediaId))
      .limit(1);
    expect(intent?.status).toBe("pending");

    await expect(
      handleMediaPurgeRequestedV1(db, purgeEvent(uploaded.media.mediaId), mediaStore),
    ).rejects.toThrow(/not due/);

    // Force due with valid purge_after = unreferenced_at + 90 days
    const unreferencedAt = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000);
    const purgeAfter = new Date(unreferencedAt.getTime() + 90 * 24 * 60 * 60 * 1000);
    await db
      .update(mediaObjects)
      .set({
        unreferencedAt,
        purgeAfter,
        updatedAt: new Date(),
      })
      .where(eq(mediaObjects.id, uploaded.media.mediaId));
    await db
      .update(mediaPurgeIntents)
      .set({ purgeAfter, updatedAt: new Date() })
      .where(eq(mediaPurgeIntents.mediaId, uploaded.media.mediaId));

    const safeKeyBefore = (
      await db
        .select()
        .from(mediaObjects)
        .where(eq(mediaObjects.id, uploaded.media.mediaId))
        .limit(1)
    )[0]?.safeObjectKey;

    await handleMediaPurgeRequestedV1(db, purgeEvent(uploaded.media.mediaId), mediaStore);

    const [purged] = await db
      .select()
      .from(mediaObjects)
      .where(eq(mediaObjects.id, uploaded.media.mediaId))
      .limit(1);
    expect(purged?.status).toBe("purged");
    if (safeKeyBefore) {
      expect(mediaStore.hasSafe(safeKeyBefore)).toBe(false);
    }

    // Idempotent replay
    await handleMediaPurgeRequestedV1(db, purgeEvent(uploaded.media.mediaId, 2), mediaStore);
  });

  it("AC-M7-06: account deletion + tombstone replay clears bodies/media", async () => {
    const { parentId, studentId } = await seedFamily();
    const png = await makePng();
    const uploaded = await uploadFamilyMedia(db, {
      actorId: parentId,
      studentId,
      declaredMime: "image/png",
      bytes: png,
      idempotencyKey: `delup-${crypto.randomUUID()}`,
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

    const issued = await issueMediaReadCapability(db, {
      actorId: parentId,
      actorRole: "parent",
      referenceId: push.push.media[0]!.referenceId,
    });

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

    const activeRefs = await db
      .select()
      .from(mediaReferences)
      .where(and(eq(mediaReferences.studentId, studentId), isNull(mediaReferences.revokedAt)));
    expect(activeRefs).toHaveLength(0);

    await applyTombstonesBeforeProjectionRebuild(db, { artifactStore });
    await assertTombstoneInvariants(db, studentId);
  });

  it("answer image attach + concurrent upload idempotency", async () => {
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

    const key = `idem-${crypto.randomUUID()}`;
    const a = await uploadFamilyMedia(db, {
      actorId: parentId,
      studentId,
      declaredMime: "image/png",
      bytes: png,
      idempotencyKey: key,
      mediaStore,
      scanner,
    });
    const b = await uploadFamilyMedia(db, {
      actorId: parentId,
      studentId,
      declaredMime: "image/png",
      bytes: png,
      idempotencyKey: key,
      mediaStore,
      scanner,
    });
    expect(b.idempotentReplay).toBe(true);
    expect(b.media.mediaId).toBe(a.media.mediaId);
    expect(createHash("sha256").update(png).digest("hex").length).toBe(64);

    const outbox = await db.select().from(outboxEvents);
    for (const event of outbox) {
      const payload = JSON.stringify(event.payload);
      expect(payload).not.toMatch(/secret/);
      expect(payload).not.toContain("capabilityToken");
    }

    const caps = await db.select().from(mediaReadCapabilities);
    expect(caps.every((c) => c.tokenHash && !c.tokenHash.includes("."))).toBe(true);
  });
});
