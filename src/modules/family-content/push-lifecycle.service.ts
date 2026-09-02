import { and, desc, eq, inArray, sql } from "drizzle-orm";

import type { Database } from "@/db";
import { familyPushes, familyPushVersions } from "@/db/schema";
import { appendAuditEvent } from "@/modules/audit/append-audit-event";
import {
  assertCanAccessPush,
  assertStudentNotFrozenForFamilyContent,
  loadPushOrThrow,
  requireCreatorOwnership,
  requireParentLinkedToStudent,
} from "@/modules/family-content/access";
import {
  FAMILY_CONTENT_EVENT_TYPES,
  READABLE_STATUSES_FOR_FAMILY,
  STUDENT_READABLE_STATUSES,
  UNPUBLISHED_EDITABLE_STATUSES,
  type FamilyPushStatus,
} from "@/modules/family-content/constants";
import { normalizePushContent } from "@/modules/family-content/content";
import {
  findAuditReplayResourceId,
  loadPushDto,
  toPushDto,
} from "@/modules/family-content/create-push.service";
import type { FamilyPushDto } from "@/modules/family-content/dto";
import { FamilyContentError } from "@/modules/family-content/errors";
import { appendOutboxEvent } from "@/modules/outbox/append-outbox-event";
import { hashIdempotencyPayload } from "@/modules/schedule/normalize-idempotency-payload";

export type EditFamilyPushInput = {
  actorId: string;
  pushId: string;
  body?: string | null;
  linkUrl?: string | null;
  scheduledPublishAt?: string | null;
  idempotencyKey: string;
  requestId?: string;
  now?: Date;
};

export async function editFamilyPush(
  db: Database,
  input: EditFamilyPushInput,
): Promise<{ push: FamilyPushDto; idempotentReplay: boolean }> {
  const content = normalizePushContent({ body: input.body, linkUrl: input.linkUrl });
  const payloadHash = hashIdempotencyPayload({
    pushId: input.pushId,
    body: content.body,
    linkUrl: content.linkUrl,
    scheduledPublishAt: input.scheduledPublishAt ?? null,
  });
  const auditKey = `audit:family-push-edit:${input.idempotencyKey}`;

  const replayId = await findAuditReplayResourceId(db, auditKey);
  if (replayId) {
    if (replayId !== input.pushId) {
      throw new FamilyContentError("IDEMPOTENCY_CONFLICT", "Edit idempotency key bound elsewhere");
    }
    return { push: await loadPushDto(db, replayId, true), idempotentReplay: true };
  }

  return db.transaction(async (tx) => {
    const replayInTx = await findAuditReplayResourceId(tx, auditKey);
    if (replayInTx) {
      return { push: await loadPushDto(tx, replayInTx, true), idempotentReplay: true };
    }

    await tx.execute(sql`SELECT id FROM family_pushes WHERE id = ${input.pushId} FOR UPDATE`);
    const push = await loadPushOrThrow(tx, input.pushId);
    await assertStudentNotFrozenForFamilyContent(tx, push.studentId, "write");
    await requireCreatorOwnership(tx, { actorId: input.actorId, push });

    if (!UNPUBLISHED_EDITABLE_STATUSES.has(push.status as FamilyPushStatus)) {
      throw new FamilyContentError("STATE_CONFLICT", "Only unpublished pushes can be edited");
    }

    const now = input.now ?? new Date();
    let nextScheduled = push.scheduledPublishAt;
    const nextStatus = push.status as FamilyPushStatus;

    if (push.status === "scheduled") {
      if (input.scheduledPublishAt) {
        const scheduled = new Date(input.scheduledPublishAt);
        if (Number.isNaN(scheduled.getTime()) || scheduled.getTime() <= now.getTime()) {
          throw new FamilyContentError("VALIDATION_ERROR", "scheduledPublishAt is invalid");
        }
        nextScheduled = scheduled;
      }
    } else if (input.scheduledPublishAt) {
      throw new FamilyContentError(
        "VALIDATION_ERROR",
        "Cannot set schedule on a draft without scheduling",
      );
    }

    const nextVersion = push.currentVersion + 1;
    const [updated] = await tx
      .update(familyPushes)
      .set({
        currentVersion: nextVersion,
        scheduledPublishAt: nextScheduled,
        status: nextStatus,
        updatedAt: now,
      })
      .where(eq(familyPushes.id, push.id))
      .returning();

    const [version] = await tx
      .insert(familyPushVersions)
      .values({
        pushId: push.id,
        version: nextVersion,
        body: content.body,
        linkUrl: content.linkUrl,
        createdAt: now,
      })
      .returning();

    await appendAuditEvent(tx, {
      actorId: input.actorId,
      action: "family_push.edited",
      resourceType: "family_push",
      resourceId: push.id,
      requestId: input.requestId ?? null,
      idempotencyKey: auditKey,
      metadata: {
        studentId: push.studentId,
        version: nextVersion,
        hasLink: Boolean(content.linkUrl),
        bodyLength: content.body.length,
        payloadHash,
      },
    });

    if (nextStatus === "scheduled" && nextScheduled) {
      // Keep a single publish_requested dedupe key; update available_at if still pending.
      await tx.execute(sql`
        UPDATE outbox_events
        SET available_at = ${nextScheduled.toISOString()}::timestamptz
        WHERE dedupe_key = ${`family_push.publish_requested:${push.id}`}
          AND status = 'pending'
      `);
    }

    return { push: toPushDto(updated!, version!, true), idempotentReplay: false };
  });
}

export type TransitionFamilyPushInput = {
  actorId: string;
  pushId: string;
  action: "publish" | "cancel" | "disable" | "delete";
  idempotencyKey: string;
  requestId?: string;
  now?: Date;
};

export async function transitionFamilyPush(
  db: Database,
  input: TransitionFamilyPushInput,
): Promise<{ push: FamilyPushDto; idempotentReplay: boolean }> {
  const auditKey = `audit:family-push-${input.action}:${input.idempotencyKey}`;
  const replayId = await findAuditReplayResourceId(db, auditKey);
  if (replayId) {
    if (replayId !== input.pushId) {
      throw new FamilyContentError(
        "IDEMPOTENCY_CONFLICT",
        "Transition idempotency key bound elsewhere",
      );
    }
    const canEdit = input.action !== "delete";
    return {
      push: await loadPushDto(db, replayId, canEdit),
      idempotentReplay: true,
    };
  }

  return db.transaction(async (tx) => {
    const replayInTx = await findAuditReplayResourceId(tx, auditKey);
    if (replayInTx) {
      return {
        push: await loadPushDto(tx, replayInTx, input.action !== "delete"),
        idempotentReplay: true,
      };
    }

    await tx.execute(sql`SELECT id FROM family_pushes WHERE id = ${input.pushId} FOR UPDATE`);
    const push = await loadPushOrThrow(tx, input.pushId);
    await assertStudentNotFrozenForFamilyContent(tx, push.studentId, "write");
    await requireCreatorOwnership(tx, { actorId: input.actorId, push });

    const now = input.now ?? new Date();
    let nextStatus: FamilyPushStatus = push.status as FamilyPushStatus;
    let publishedAt = push.publishedAt;
    let scheduledPublishAt = push.scheduledPublishAt;

    if (input.action === "publish") {
      if (push.status !== "draft" && push.status !== "scheduled") {
        throw new FamilyContentError("STATE_CONFLICT", "Push cannot be published from this state");
      }
      nextStatus = "published";
      publishedAt = now;
      scheduledPublishAt = push.scheduledPublishAt;
    } else if (input.action === "cancel") {
      if (push.status !== "scheduled") {
        throw new FamilyContentError("STATE_CONFLICT", "Only scheduled pushes can be cancelled");
      }
      nextStatus = "cancelled";
      scheduledPublishAt = push.scheduledPublishAt;
    } else if (input.action === "disable") {
      if (push.status !== "published") {
        throw new FamilyContentError("STATE_CONFLICT", "Only published pushes can be disabled");
      }
      nextStatus = "disabled";
    } else if (input.action === "delete") {
      if (push.status === "deleted" || push.status === "cancelled") {
        throw new FamilyContentError("STATE_CONFLICT", "Push is already terminal");
      }
      nextStatus = "deleted";
    }

    const [updated] = await tx
      .update(familyPushes)
      .set({
        status: nextStatus,
        publishedAt,
        scheduledPublishAt,
        updatedAt: now,
      })
      .where(eq(familyPushes.id, push.id))
      .returning();

    await appendAuditEvent(tx, {
      actorId: input.actorId,
      action: `family_push.${input.action}`,
      resourceType: "family_push",
      resourceId: push.id,
      requestId: input.requestId ?? null,
      idempotencyKey: auditKey,
      metadata: {
        studentId: push.studentId,
        fromStatus: push.status,
        toStatus: nextStatus,
      },
    });

    if (input.action === "publish") {
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

    if (input.action === "cancel" || input.action === "delete") {
      // Leave pending publish request; worker will no-op on non-scheduled status.
    }

    const [version] = await tx
      .select()
      .from(familyPushVersions)
      .where(
        sql`${familyPushVersions.pushId} = ${push.id}::uuid AND ${familyPushVersions.version} = ${updated!.currentVersion}`,
      )
      .limit(1);

    return {
      push: toPushDto(updated!, version!, input.action !== "delete"),
      idempotentReplay: false,
    };
  });
}

export async function getFamilyPush(
  db: Database,
  input: {
    actorId: string;
    actorRole: "parent" | "student";
    pushId: string;
  },
): Promise<FamilyPushDto> {
  const push = await loadPushOrThrow(db, input.pushId);
  const access = await assertCanAccessPush(db, {
    actorId: input.actorId,
    actorRole: input.actorRole,
    push,
  });
  return loadPushDto(db, push.id, access === "creator");
}

export async function listFamilyPushes(
  db: Database,
  input: {
    actorId: string;
    actorRole: "parent" | "student";
    studentId: string;
  },
): Promise<FamilyPushDto[]> {
  await assertStudentNotFrozenForFamilyContent(db, input.studentId, "read");

  if (input.actorRole === "student") {
    if (input.actorId !== input.studentId) {
      throw new FamilyContentError("FORBIDDEN", "Access denied");
    }
  } else {
    await requireParentLinkedToStudent(db, input.actorId, input.studentId);
  }

  const statuses =
    input.actorRole === "student"
      ? [...STUDENT_READABLE_STATUSES]
      : [...READABLE_STATUSES_FOR_FAMILY];

  const pushes = await db
    .select()
    .from(familyPushes)
    .where(and(eq(familyPushes.studentId, input.studentId), inArray(familyPushes.status, statuses)))
    .orderBy(desc(familyPushes.updatedAt));

  const results: FamilyPushDto[] = [];
  for (const push of pushes) {
    if (input.actorRole === "parent") {
      // creator or linked parent already verified via relationship
    }
    const version = await db
      .select()
      .from(familyPushVersions)
      .where(
        sql`${familyPushVersions.pushId} = ${push.id}::uuid AND ${familyPushVersions.version} = ${push.currentVersion}`,
      )
      .limit(1);
    if (!version[0]) {
      continue;
    }
    results.push(
      toPushDto(
        push,
        version[0],
        input.actorRole === "parent" && push.creatorParentId === input.actorId,
      ),
    );
  }
  return results;
}

/** Called inside relationship-end transaction. */
export async function cancelScheduledPushesOnRelationshipEnd(
  tx: Database,
  input: {
    parentId: string;
    studentId: string;
    endedAt: Date;
    relationshipEndIdempotencyKey: string;
    actorId: string;
    requestId?: string;
  },
): Promise<number> {
  const scheduled = await tx
    .select()
    .from(familyPushes)
    .where(
      and(
        eq(familyPushes.creatorParentId, input.parentId),
        eq(familyPushes.studentId, input.studentId),
        eq(familyPushes.status, "scheduled"),
      ),
    );

  let cancelled = 0;
  for (const push of scheduled) {
    const deactivateKey = `rel-end:${input.relationshipEndIdempotencyKey}:push:${push.id}`;
    await tx
      .update(familyPushes)
      .set({
        status: "cancelled",
        updatedAt: input.endedAt,
      })
      .where(and(eq(familyPushes.id, push.id), eq(familyPushes.status, "scheduled")));

    await appendAuditEvent(tx, {
      actorId: input.actorId,
      action: "family_push.cancelled",
      resourceType: "family_push",
      resourceId: push.id,
      requestId: input.requestId ?? null,
      idempotencyKey: `audit:rel-end-push-cancelled:${deactivateKey}`,
      metadata: {
        studentId: push.studentId,
        reason: "relationship_ended",
        creatorParentId: input.parentId,
      },
    });
    cancelled += 1;
  }
  return cancelled;
}
