import { eq, sql } from "drizzle-orm";

import type { Database } from "@/db";
import { familyPushes } from "@/db/schema";
import { appendAuditEvent } from "@/modules/audit/append-audit-event";
import {
  hasActiveRelationship,
  listActiveParentIdsForStudent,
} from "@/modules/family-access/authorization.service";
import { isStudentAccountFrozen } from "@/modules/data-lifecycle/freeze-guard.service";
import { FAMILY_CONTENT_EVENT_TYPES } from "@/modules/family-content/constants";
import {
  createNotificationIfAbsent,
  NOTIFICATION_TYPES,
} from "@/modules/notification/notification.service";
import { appendOutboxEvent } from "@/modules/outbox/append-outbox-event";
import type { ClaimedOutboxEvent } from "@/modules/outbox/process-outbox-event.service";

export type M7OutboxHandler = (db: Database, event: ClaimedOutboxEvent) => Promise<void>;

const M7_EVENT_HANDLERS: ReadonlyMap<string, ReadonlyMap<number, M7OutboxHandler>> = new Map([
  [
    FAMILY_CONTENT_EVENT_TYPES.PUBLISH_REQUESTED,
    new Map<number, M7OutboxHandler>([[1, handlePublishRequestedV1]]),
  ],
  [
    FAMILY_CONTENT_EVENT_TYPES.PUBLISHED,
    new Map<number, M7OutboxHandler>([[1, handlePublishedV1]]),
  ],
  [FAMILY_CONTENT_EVENT_TYPES.ANSWERED, new Map<number, M7OutboxHandler>([[1, handleAnsweredV1]])],
  [
    FAMILY_CONTENT_EVENT_TYPES.COMMENTED,
    new Map<number, M7OutboxHandler>([[1, handleCommentedV1]]),
  ],
]);

export function getM7EventHandler(eventType: string, eventVersion: number): M7OutboxHandler | null {
  return M7_EVENT_HANDLERS.get(eventType)?.get(eventVersion) ?? null;
}

async function cancelScheduledPushInTx(
  tx: Database,
  push: typeof familyPushes.$inferSelect,
  reason: "frozen" | "relationship_inactive",
): Promise<void> {
  const now = new Date();
  await tx
    .update(familyPushes)
    .set({ status: "cancelled", updatedAt: now })
    .where(eq(familyPushes.id, push.id));

  await appendAuditEvent(tx, {
    actorId: null,
    action: "family_push.cancelled",
    resourceType: "family_push",
    resourceId: push.id,
    idempotencyKey: `audit:family-push-worker-cancel:${push.id}`,
    metadata: {
      studentId: push.studentId,
      fromStatus: "scheduled",
      toStatus: "cancelled",
      reason,
    },
  });

  await appendOutboxEvent(tx, {
    aggregateType: "family_push",
    aggregateId: push.id,
    eventType: FAMILY_CONTENT_EVENT_TYPES.CANCELLED,
    dedupeKey: `family_push.cancelled:${push.id}`,
    payload: {
      pushId: push.id,
      studentId: push.studentId,
      creatorParentId: push.creatorParentId,
      reason,
    },
  });
}

async function handlePublishRequestedV1(db: Database, event: ClaimedOutboxEvent): Promise<void> {
  const pushId = event.payload.pushId;
  if (typeof pushId !== "string") {
    throw new Error("publish_requested payload missing pushId");
  }

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM family_pushes WHERE id = ${pushId} FOR UPDATE`);
    const [push] = await tx.select().from(familyPushes).where(eq(familyPushes.id, pushId)).limit(1);
    if (!push) {
      return;
    }

    if (push.status !== "scheduled") {
      // Cancelled, deleted, or already published — safe no-op.
      return;
    }

    if (await isStudentAccountFrozen(tx, push.studentId)) {
      await cancelScheduledPushInTx(tx, push, "frozen");
      return;
    }

    if (!(await hasActiveRelationship(tx, push.creatorParentId, push.studentId))) {
      await cancelScheduledPushInTx(tx, push, "relationship_inactive");
      return;
    }

    const publishedAt = new Date();
    await tx
      .update(familyPushes)
      .set({
        status: "published",
        publishedAt,
        updatedAt: publishedAt,
      })
      .where(eq(familyPushes.id, push.id));

    await appendAuditEvent(tx, {
      actorId: null,
      action: "family_push.published",
      resourceType: "family_push",
      resourceId: push.id,
      idempotencyKey: `audit:family-push-worker-publish:${push.id}`,
      metadata: {
        studentId: push.studentId,
        fromStatus: "scheduled",
        toStatus: "published",
        reason: "scheduled_publish",
      },
    });

    await appendOutboxEvent(tx, {
      aggregateType: "family_push",
      aggregateId: push.id,
      eventType: FAMILY_CONTENT_EVENT_TYPES.PUBLISHED,
      dedupeKey: `family_push.published:${push.id}`,
      payload: {
        pushId: push.id,
        studentId: push.studentId,
        creatorParentId: push.creatorParentId,
        publishedAt: publishedAt.toISOString(),
      },
    });
  });
}

async function handlePublishedV1(db: Database, event: ClaimedOutboxEvent): Promise<void> {
  const pushId = event.payload.pushId;
  const studentId = event.payload.studentId;
  const creatorParentId = event.payload.creatorParentId;
  if (
    typeof pushId !== "string" ||
    typeof studentId !== "string" ||
    typeof creatorParentId !== "string"
  ) {
    throw new Error("published payload incomplete");
  }

  await db.transaction(async (tx) => {
    const parentIds = await listActiveParentIdsForStudent(tx, studentId);
    const recipients = new Set<string>([studentId, ...parentIds]);

    for (const recipientUserId of recipients) {
      await createNotificationIfAbsent(tx, {
        recipientUserId,
        notificationType: NOTIFICATION_TYPES.PUBLISHED,
        resourceType: "family_push",
        resourceId: pushId,
        actorUserId: creatorParentId,
        dedupeKey: `notif:family_push.published:${pushId}:${recipientUserId}`,
      });
    }
  });
}

async function handleAnsweredV1(db: Database, event: ClaimedOutboxEvent): Promise<void> {
  const pushId = event.payload.pushId;
  const studentId = event.payload.studentId;
  const answerId = event.payload.answerId;
  const version = event.payload.version;
  if (
    typeof pushId !== "string" ||
    typeof studentId !== "string" ||
    typeof answerId !== "string" ||
    typeof version !== "number"
  ) {
    throw new Error("answered payload incomplete");
  }

  await db.transaction(async (tx) => {
    const parentIds = await listActiveParentIdsForStudent(tx, studentId);
    for (const recipientUserId of parentIds) {
      await createNotificationIfAbsent(tx, {
        recipientUserId,
        notificationType: NOTIFICATION_TYPES.ANSWERED,
        resourceType: "family_push",
        resourceId: pushId,
        actorUserId: studentId,
        dedupeKey: `notif:family_push.answered:${answerId}:v${version}:${recipientUserId}`,
      });
    }
  });
}

async function handleCommentedV1(db: Database, event: ClaimedOutboxEvent): Promise<void> {
  const pushId = event.payload.pushId;
  const studentId = event.payload.studentId;
  const commentId = event.payload.commentId;
  const actorUserId = event.payload.actorUserId;
  const version = event.payload.version;
  if (
    typeof pushId !== "string" ||
    typeof studentId !== "string" ||
    typeof commentId !== "string" ||
    typeof actorUserId !== "string" ||
    typeof version !== "number"
  ) {
    throw new Error("commented payload incomplete");
  }

  await db.transaction(async (tx) => {
    const parentIds = await listActiveParentIdsForStudent(tx, studentId);
    const recipients = new Set<string>([studentId, ...parentIds]);
    recipients.delete(actorUserId);

    for (const recipientUserId of recipients) {
      await createNotificationIfAbsent(tx, {
        recipientUserId,
        notificationType: NOTIFICATION_TYPES.COMMENTED,
        resourceType: "family_push",
        resourceId: pushId,
        actorUserId,
        dedupeKey: `notif:family_push.commented:${commentId}:v${version}:${recipientUserId}`,
      });
    }
  });
}
