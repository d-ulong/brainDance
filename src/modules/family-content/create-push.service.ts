import { eq, sql } from "drizzle-orm";

import type { Database } from "@/db";
import { familyPushes, familyPushVersions } from "@/db/schema";
import { appendAuditEvent } from "@/modules/audit/append-audit-event";
import {
  assertStudentNotFrozenForFamilyContent,
  requireParentLinkedToStudent,
} from "@/modules/family-content/access";
import {
  FAMILY_CONTENT_EVENT_TYPES,
  type FamilyPushPublishMode,
  type FamilyPushStatus,
} from "@/modules/family-content/constants";
import { normalizePushContent } from "@/modules/family-content/content";
import type { FamilyPushDto } from "@/modules/family-content/dto";
import { FamilyContentError } from "@/modules/family-content/errors";
import { lockUserRowForUpdate } from "@/modules/identity/user-role.service";
import { appendOutboxEvent } from "@/modules/outbox/append-outbox-event";
import { hashIdempotencyPayload } from "@/modules/schedule/normalize-idempotency-payload";

export type CreateFamilyPushInput = {
  actorId: string;
  studentId: string;
  body?: string | null;
  linkUrl?: string | null;
  publishMode: FamilyPushPublishMode;
  scheduledPublishAt?: string | null;
  idempotencyKey: string;
  requestId?: string;
  now?: Date;
};

export type CreateFamilyPushResult = {
  push: FamilyPushDto;
  idempotentReplay: boolean;
};

function toPushDto(
  push: typeof familyPushes.$inferSelect,
  version: typeof familyPushVersions.$inferSelect,
  canEdit: boolean,
): FamilyPushDto {
  return {
    pushId: push.id,
    studentId: push.studentId,
    creatorParentId: push.creatorParentId,
    status: push.status,
    currentVersion: push.currentVersion,
    body: version.body,
    linkUrl: version.linkUrl,
    scheduledPublishAt: push.scheduledPublishAt?.toISOString() ?? null,
    publishedAt: push.publishedAt?.toISOString() ?? null,
    canEdit,
    createdAt: push.createdAt.toISOString(),
    updatedAt: push.updatedAt.toISOString(),
  };
}

async function findCreateReplay(
  db: Database,
  creatorParentId: string,
  idempotencyKey: string,
  payloadHash: string,
): Promise<CreateFamilyPushResult | null> {
  const [existing] = await db
    .select()
    .from(familyPushes)
    .where(
      sql`${familyPushes.creatorParentId} = ${creatorParentId}::uuid AND ${familyPushes.createIdempotencyKey} = ${idempotencyKey}`,
    )
    .limit(1);

  if (!existing) {
    return null;
  }
  if (existing.createIdempotencyPayloadHash !== payloadHash) {
    throw new FamilyContentError(
      "IDEMPOTENCY_CONFLICT",
      "Create push idempotency payload mismatch",
    );
  }

  const [version] = await db
    .select()
    .from(familyPushVersions)
    .where(
      sql`${familyPushVersions.pushId} = ${existing.id}::uuid AND ${familyPushVersions.version} = ${existing.currentVersion}`,
    )
    .limit(1);

  if (!version) {
    throw new FamilyContentError("NOT_FOUND", "Push version not found");
  }

  return {
    push: toPushDto(existing, version, true),
    idempotentReplay: true,
  };
}

export async function createFamilyPush(
  db: Database,
  input: CreateFamilyPushInput,
): Promise<CreateFamilyPushResult> {
  const now = input.now ?? new Date();
  const content = normalizePushContent({ body: input.body, linkUrl: input.linkUrl });

  let status: FamilyPushStatus;
  let scheduledPublishAt: Date | null = null;
  let publishedAt: Date | null = null;

  if (input.publishMode === "draft") {
    status = "draft";
  } else if (input.publishMode === "immediate") {
    status = "published";
    publishedAt = now;
  } else {
    if (!input.scheduledPublishAt) {
      throw new FamilyContentError("VALIDATION_ERROR", "scheduledPublishAt is required");
    }
    scheduledPublishAt = new Date(input.scheduledPublishAt);
    if (Number.isNaN(scheduledPublishAt.getTime())) {
      throw new FamilyContentError("VALIDATION_ERROR", "scheduledPublishAt is invalid");
    }
    if (scheduledPublishAt.getTime() <= now.getTime()) {
      throw new FamilyContentError("VALIDATION_ERROR", "scheduledPublishAt must be in the future");
    }
    status = "scheduled";
  }

  const payloadHash = hashIdempotencyPayload({
    studentId: input.studentId,
    body: content.body,
    linkUrl: content.linkUrl,
    publishMode: input.publishMode,
    scheduledPublishAt: scheduledPublishAt?.toISOString() ?? null,
  });

  const replay = await findCreateReplay(db, input.actorId, input.idempotencyKey, payloadHash);
  if (replay) {
    return replay;
  }

  await requireParentLinkedToStudent(db, input.actorId, input.studentId);
  await assertStudentNotFrozenForFamilyContent(db, input.studentId, "write");

  return db.transaction(async (tx) => {
    const replayInTx = await findCreateReplay(tx, input.actorId, input.idempotencyKey, payloadHash);
    if (replayInTx) {
      return replayInTx;
    }

    await requireParentLinkedToStudent(tx, input.actorId, input.studentId);
    await assertStudentNotFrozenForFamilyContent(tx, input.studentId, "write");
    await lockUserRowForUpdate(tx, input.studentId);

    const [push] = await tx
      .insert(familyPushes)
      .values({
        studentId: input.studentId,
        creatorParentId: input.actorId,
        status,
        currentVersion: 1,
        scheduledPublishAt,
        publishedAt,
        createIdempotencyKey: input.idempotencyKey,
        createIdempotencyPayloadHash: payloadHash,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({
        target: [familyPushes.creatorParentId, familyPushes.createIdempotencyKey],
      })
      .returning();

    if (!push) {
      const raced = await findCreateReplay(tx, input.actorId, input.idempotencyKey, payloadHash);
      if (raced) {
        return raced;
      }
      throw new FamilyContentError(
        "IDEMPOTENCY_CONFLICT",
        "Create push idempotency payload mismatch",
      );
    }

    const [version] = await tx
      .insert(familyPushVersions)
      .values({
        pushId: push.id,
        version: 1,
        body: content.body,
        linkUrl: content.linkUrl,
        createdAt: now,
      })
      .returning();

    await appendAuditEvent(tx, {
      actorId: input.actorId,
      action: "family_push.created",
      resourceType: "family_push",
      resourceId: push.id,
      requestId: input.requestId ?? null,
      idempotencyKey: `audit:family-push-create:${input.idempotencyKey}`,
      metadata: {
        studentId: push.studentId,
        status: push.status,
        version: 1,
        hasLink: Boolean(content.linkUrl),
        bodyLength: content.body.length,
      },
    });

    if (status === "scheduled" && scheduledPublishAt) {
      await appendOutboxEvent(tx, {
        aggregateType: "family_push",
        aggregateId: push.id,
        eventType: FAMILY_CONTENT_EVENT_TYPES.PUBLISH_REQUESTED,
        dedupeKey: `family_push.publish_requested:${push.id}`,
        availableAt: scheduledPublishAt,
        payload: {
          pushId: push.id,
          studentId: push.studentId,
          creatorParentId: push.creatorParentId,
        },
      });
    }

    if (status === "published") {
      await appendOutboxEvent(tx, {
        aggregateType: "family_push",
        aggregateId: push.id,
        eventType: FAMILY_CONTENT_EVENT_TYPES.PUBLISHED,
        dedupeKey: `family_push.published:${push.id}`,
        payload: {
          pushId: push.id,
          studentId: push.studentId,
          creatorParentId: push.creatorParentId,
          publishedAt: publishedAt!.toISOString(),
        },
      });
    }

    return {
      push: toPushDto(push, version!, true),
      idempotentReplay: false,
    };
  });
}

export async function loadPushDto(
  db: Database,
  pushId: string,
  canEdit: boolean,
): Promise<FamilyPushDto> {
  const [push] = await db.select().from(familyPushes).where(eq(familyPushes.id, pushId)).limit(1);
  if (!push) {
    throw new FamilyContentError("NOT_FOUND", "Push not found");
  }
  const [version] = await db
    .select()
    .from(familyPushVersions)
    .where(
      sql`${familyPushVersions.pushId} = ${push.id}::uuid AND ${familyPushVersions.version} = ${push.currentVersion}`,
    )
    .limit(1);
  if (!version) {
    throw new FamilyContentError("NOT_FOUND", "Push version not found");
  }
  return toPushDto(push, version, canEdit);
}

export { toPushDto };
