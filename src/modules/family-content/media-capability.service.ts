import { and, eq, gt, isNull } from "drizzle-orm";

import type { Database } from "@/db";
import {
  familyPushVersions,
  mediaObjects,
  mediaReadCapabilities,
  mediaReferences,
  pushAnswerVersions,
  pushAnswers,
  users,
} from "@/db/schema";
import { generateMediaCapabilityToken, hashMediaCapabilityToken } from "@/lib/crypto";
import {
  assertCanAccessPush,
  assertStudentNotFrozenForFamilyContent,
  loadPushOrThrow,
} from "@/modules/family-content/access";
import { MEDIA_READ_TTL_MS } from "@/modules/family-content/constants";
import { FamilyContentError } from "@/modules/family-content/errors";
import type { PrivateMediaStore } from "@/modules/family-content/private-media-store";

async function loadStudentAuthorizationEpoch(db: Database, studentId: string): Promise<number> {
  const [row] = await db
    .select({ authorizationEpoch: users.authorizationEpoch })
    .from(users)
    .where(eq(users.id, studentId))
    .limit(1);
  if (!row) {
    throw new FamilyContentError("NOT_FOUND", "Media not found");
  }
  return row.authorizationEpoch;
}

async function assertReferenceReadable(
  db: Database,
  input: {
    actorId: string;
    actorRole: "parent" | "student";
    reference: typeof mediaReferences.$inferSelect;
  },
): Promise<void> {
  await assertStudentNotFrozenForFamilyContent(db, input.reference.studentId, "read");

  if (input.reference.resourceType === "family_push_version") {
    const [version] = await db
      .select()
      .from(familyPushVersions)
      .where(eq(familyPushVersions.id, input.reference.resourceId))
      .limit(1);
    if (!version) {
      throw new FamilyContentError("NOT_FOUND", "Media not found");
    }
    const push = await loadPushOrThrow(db, version.pushId);
    await assertCanAccessPush(db, {
      actorId: input.actorId,
      actorRole: input.actorRole,
      push,
    });
    return;
  }

  const [version] = await db
    .select()
    .from(pushAnswerVersions)
    .where(eq(pushAnswerVersions.id, input.reference.resourceId))
    .limit(1);
  if (!version) {
    throw new FamilyContentError("NOT_FOUND", "Media not found");
  }
  const [answer] = await db
    .select()
    .from(pushAnswers)
    .where(eq(pushAnswers.id, version.answerId))
    .limit(1);
  if (!answer) {
    throw new FamilyContentError("NOT_FOUND", "Media not found");
  }
  const push = await loadPushOrThrow(db, answer.pushId);
  await assertCanAccessPush(db, {
    actorId: input.actorId,
    actorRole: input.actorRole,
    push,
  });
}

export async function issueMediaReadCapability(
  db: Database,
  input: {
    actorId: string;
    actorRole: "parent" | "student";
    referenceId: string;
    now?: Date;
  },
): Promise<{ capabilityToken: string; expiresAt: string; mediaId: string; referenceId: string }> {
  const now = input.now ?? new Date();
  const [reference] = await db
    .select()
    .from(mediaReferences)
    .where(eq(mediaReferences.id, input.referenceId))
    .limit(1);

  if (!reference || reference.revokedAt) {
    throw new FamilyContentError("NOT_FOUND", "Media not found");
  }

  const [media] = await db
    .select()
    .from(mediaObjects)
    .where(eq(mediaObjects.id, reference.mediaId))
    .limit(1);
  if (!media || media.status !== "ready" || !media.safeObjectKey) {
    throw new FamilyContentError("NOT_FOUND", "Media not found");
  }

  await assertReferenceReadable(db, {
    actorId: input.actorId,
    actorRole: input.actorRole,
    reference,
  });

  const authorizationEpoch = await loadStudentAuthorizationEpoch(db, reference.studentId);
  const expiresAt = new Date(now.getTime() + MEDIA_READ_TTL_MS);
  const capabilityToken = generateMediaCapabilityToken();
  const tokenHash = hashMediaCapabilityToken(capabilityToken);

  await db.insert(mediaReadCapabilities).values({
    tokenHash,
    mediaId: media.id,
    referenceId: reference.id,
    actorId: input.actorId,
    studentId: reference.studentId,
    authorizationEpoch,
    expiresAt,
    createdAt: now,
  });

  return {
    capabilityToken,
    expiresAt: expiresAt.toISOString(),
    mediaId: media.id,
    referenceId: reference.id,
  };
}

export async function readMediaWithCapability(
  db: Database,
  input: {
    capabilityToken: string;
    mediaStore: PrivateMediaStore;
    now?: Date;
  },
): Promise<{ bytes: Buffer; mime: string; mediaId: string }> {
  const now = input.now ?? new Date();
  const tokenHash = hashMediaCapabilityToken(input.capabilityToken);

  const [capability] = await db
    .select()
    .from(mediaReadCapabilities)
    .where(eq(mediaReadCapabilities.tokenHash, tokenHash))
    .limit(1);

  if (!capability || capability.revokedAt) {
    throw new FamilyContentError("TOKEN_INVALID", "Media capability invalid");
  }
  if (capability.expiresAt.getTime() <= now.getTime()) {
    throw new FamilyContentError("TOKEN_EXPIRED", "Media capability expired");
  }

  const epoch = await loadStudentAuthorizationEpoch(db, capability.studentId);
  if (epoch !== capability.authorizationEpoch) {
    throw new FamilyContentError("TOKEN_INVALID", "Media capability invalid");
  }

  const [reference] = await db
    .select()
    .from(mediaReferences)
    .where(eq(mediaReferences.id, capability.referenceId))
    .limit(1);
  if (!reference || reference.revokedAt) {
    throw new FamilyContentError("NOT_FOUND", "Media not found");
  }

  const [media] = await db
    .select()
    .from(mediaObjects)
    .where(eq(mediaObjects.id, capability.mediaId))
    .limit(1);
  if (!media || media.status !== "ready" || !media.safeObjectKey) {
    throw new FamilyContentError("NOT_FOUND", "Media not found");
  }

  // Re-auth: resolve actor role from users and check resource access.
  const [actor] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, capability.actorId))
    .limit(1);
  if (!actor || (actor.role !== "parent" && actor.role !== "student")) {
    throw new FamilyContentError("NOT_FOUND", "Media not found");
  }

  await assertReferenceReadable(db, {
    actorId: capability.actorId,
    actorRole: actor.role,
    reference,
  });

  const bytes = await input.mediaStore.readSafe(media.safeObjectKey);
  if (!bytes) {
    throw new FamilyContentError("MEDIA_UNAVAILABLE", "Media object unavailable");
  }

  return {
    bytes,
    mime: media.detectedMime ?? media.declaredMime,
    mediaId: media.id,
  };
}

export async function revokeCapabilitiesForMediaInTx(
  tx: Database,
  mediaId: string,
  now: Date,
): Promise<number> {
  const result = await tx
    .update(mediaReadCapabilities)
    .set({ revokedAt: now })
    .where(
      and(eq(mediaReadCapabilities.mediaId, mediaId), isNull(mediaReadCapabilities.revokedAt)),
    )
    .returning({ id: mediaReadCapabilities.id });
  return result.length;
}

export async function countActiveCapabilitiesForStudent(
  db: Database,
  studentId: string,
  now: Date = new Date(),
): Promise<number> {
  const rows = await db
    .select({ id: mediaReadCapabilities.id })
    .from(mediaReadCapabilities)
    .where(
      and(
        eq(mediaReadCapabilities.studentId, studentId),
        isNull(mediaReadCapabilities.revokedAt),
        gt(mediaReadCapabilities.expiresAt, now),
      ),
    );
  return rows.length;
}
