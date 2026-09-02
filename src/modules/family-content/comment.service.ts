import { and, asc, eq, isNull, sql } from "drizzle-orm";

import type { Database } from "@/db";
import { pushCommentVersions, pushComments } from "@/db/schema";
import { appendAuditEvent } from "@/modules/audit/append-audit-event";
import { hasActiveRelationship } from "@/modules/family-access/authorization.service";
import {
  assertCanAccessPush,
  assertStudentNotFrozenForFamilyContent,
  loadPushOrThrow,
} from "@/modules/family-content/access";
import {
  COMMENTABLE_STATUSES,
  FAMILY_CONTENT_EVENT_TYPES,
} from "@/modules/family-content/constants";
import { normalizeCommentBody } from "@/modules/family-content/content";
import {
  findAuditReplay,
  assertAuditReplayMatch,
} from "@/modules/family-content/create-push.service";
import type { PushCommentDto } from "@/modules/family-content/dto";
import { FamilyContentError } from "@/modules/family-content/errors";
import { appendOutboxEvent } from "@/modules/outbox/append-outbox-event";
import { hashIdempotencyPayload } from "@/modules/schedule/normalize-idempotency-payload";

function toCommentDto(
  comment: typeof pushComments.$inferSelect,
  version: typeof pushCommentVersions.$inferSelect | null,
  actorId: string,
): PushCommentDto {
  const deleted = comment.deletedAt !== null;
  return {
    commentId: comment.id,
    pushId: comment.pushId,
    authorId: comment.authorId,
    parentCommentId: comment.parentCommentId,
    currentVersion: comment.currentVersion,
    body: deleted ? null : (version?.body ?? null),
    deleted,
    canEdit: !deleted && comment.authorId === actorId,
    createdAt: comment.createdAt.toISOString(),
    updatedAt: comment.updatedAt.toISOString(),
  };
}

export async function listPushComments(
  db: Database,
  input: { actorId: string; actorRole: "parent" | "student"; pushId: string },
): Promise<PushCommentDto[]> {
  const push = await loadPushOrThrow(db, input.pushId);
  await assertCanAccessPush(db, {
    actorId: input.actorId,
    actorRole: input.actorRole,
    push,
  });

  const comments = await db
    .select()
    .from(pushComments)
    .where(eq(pushComments.pushId, push.id))
    .orderBy(asc(pushComments.createdAt));

  const result: PushCommentDto[] = [];
  for (const comment of comments) {
    if (comment.deletedAt) {
      result.push(toCommentDto(comment, null, input.actorId));
      continue;
    }
    const [version] = await db
      .select()
      .from(pushCommentVersions)
      .where(
        sql`${pushCommentVersions.commentId} = ${comment.id}::uuid AND ${pushCommentVersions.version} = ${comment.currentVersion}`,
      )
      .limit(1);
    result.push(toCommentDto(comment, version ?? null, input.actorId));
  }
  return result;
}

export type CreatePushCommentInput = {
  actorId: string;
  actorRole: "parent" | "student";
  pushId: string;
  body: string;
  parentCommentId?: string | null;
  idempotencyKey: string;
  requestId?: string;
  now?: Date;
};

export async function createPushComment(
  db: Database,
  input: CreatePushCommentInput,
): Promise<{ comment: PushCommentDto; idempotentReplay: boolean }> {
  const body = normalizeCommentBody(input.body);
  const payloadHash = hashIdempotencyPayload({
    pushId: input.pushId,
    body,
    parentCommentId: input.parentCommentId ?? null,
  });

  const [existing] = await db
    .select()
    .from(pushComments)
    .where(
      and(
        eq(pushComments.authorId, input.actorId),
        eq(pushComments.createIdempotencyKey, input.idempotencyKey),
      ),
    )
    .limit(1);

  if (existing) {
    if (existing.createIdempotencyPayloadHash !== payloadHash) {
      throw new FamilyContentError("IDEMPOTENCY_CONFLICT", "Comment idempotency payload mismatch");
    }
    const [version] = await db
      .select()
      .from(pushCommentVersions)
      .where(
        sql`${pushCommentVersions.commentId} = ${existing.id}::uuid AND ${pushCommentVersions.version} = ${existing.currentVersion}`,
      )
      .limit(1);
    return {
      comment: toCommentDto(existing, version ?? null, input.actorId),
      idempotentReplay: true,
    };
  }

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM family_pushes WHERE id = ${input.pushId} FOR UPDATE`);
    const push = await loadPushOrThrow(tx, input.pushId);
    await assertStudentNotFrozenForFamilyContent(tx, push.studentId, "write");

    if (!COMMENTABLE_STATUSES.has(push.status as "published")) {
      throw new FamilyContentError("STATE_CONFLICT", "Push does not accept comments");
    }

    if (input.actorRole === "student") {
      if (input.actorId !== push.studentId) {
        throw new FamilyContentError("FORBIDDEN", "Access denied");
      }
    } else if (!(await hasActiveRelationship(tx, input.actorId, push.studentId))) {
      throw new FamilyContentError("FORBIDDEN", "Access denied");
    }

    if (input.parentCommentId) {
      const [parent] = await tx
        .select()
        .from(pushComments)
        .where(
          and(
            eq(pushComments.id, input.parentCommentId),
            eq(pushComments.pushId, push.id),
            isNull(pushComments.deletedAt),
          ),
        )
        .limit(1);
      if (!parent) {
        throw new FamilyContentError("NOT_FOUND", "Parent comment not found");
      }
    }

    const now = input.now ?? new Date();
    const [comment] = await tx
      .insert(pushComments)
      .values({
        pushId: push.id,
        authorId: input.actorId,
        parentCommentId: input.parentCommentId ?? null,
        currentVersion: 1,
        createIdempotencyKey: input.idempotencyKey,
        createIdempotencyPayloadHash: payloadHash,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning();

    if (!comment) {
      const [raced] = await tx
        .select()
        .from(pushComments)
        .where(
          and(
            eq(pushComments.authorId, input.actorId),
            eq(pushComments.createIdempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);
      if (!raced || raced.createIdempotencyPayloadHash !== payloadHash) {
        throw new FamilyContentError(
          "IDEMPOTENCY_CONFLICT",
          "Comment idempotency payload mismatch",
        );
      }
      const [version] = await tx
        .select()
        .from(pushCommentVersions)
        .where(
          sql`${pushCommentVersions.commentId} = ${raced.id}::uuid AND ${pushCommentVersions.version} = ${raced.currentVersion}`,
        )
        .limit(1);
      return {
        comment: toCommentDto(raced, version ?? null, input.actorId),
        idempotentReplay: true,
      };
    }

    const [version] = await tx
      .insert(pushCommentVersions)
      .values({
        commentId: comment.id,
        version: 1,
        body,
        createdAt: now,
      })
      .returning();

    await appendAuditEvent(tx, {
      actorId: input.actorId,
      action: "family_push.commented",
      resourceType: "push_comment",
      resourceId: comment.id,
      requestId: input.requestId ?? null,
      idempotencyKey: `audit:push-comment-create:${input.idempotencyKey}`,
      metadata: {
        pushId: push.id,
        studentId: push.studentId,
        version: 1,
        bodyLength: body.length,
        hasParent: Boolean(input.parentCommentId),
      },
    });

    await appendOutboxEvent(tx, {
      aggregateType: "family_push",
      aggregateId: push.id,
      eventType: FAMILY_CONTENT_EVENT_TYPES.COMMENTED,
      dedupeKey: `family_push.commented:${comment.id}:v1`,
      payload: {
        pushId: push.id,
        commentId: comment.id,
        studentId: push.studentId,
        actorUserId: input.actorId,
        version: 1,
      },
    });

    return { comment: toCommentDto(comment, version!, input.actorId), idempotentReplay: false };
  });
}

export type MutatePushCommentInput = {
  actorId: string;
  commentId: string;
  body?: string;
  delete?: boolean;
  idempotencyKey: string;
  requestId?: string;
  now?: Date;
};

export async function mutatePushComment(
  db: Database,
  input: MutatePushCommentInput,
): Promise<{ comment: PushCommentDto; idempotentReplay: boolean }> {
  const auditKey = `audit:push-comment-mutate:${input.idempotencyKey}`;
  const payloadHash = input.delete
    ? hashIdempotencyPayload({
        command: "delete",
        commentId: input.commentId,
      })
    : hashIdempotencyPayload({
        command: "edit",
        commentId: input.commentId,
        body: input.body ? normalizeCommentBody(input.body) : null,
      });

  async function loadCommentReplay(
    client: Database,
    commentId: string,
  ): Promise<{ comment: PushCommentDto; idempotentReplay: boolean }> {
    const [comment] = await client
      .select()
      .from(pushComments)
      .where(eq(pushComments.id, commentId))
      .limit(1);
    if (!comment) {
      throw new FamilyContentError("NOT_FOUND", "Comment not found");
    }
    const [version] = comment.deletedAt
      ? [null]
      : await client
          .select()
          .from(pushCommentVersions)
          .where(
            sql`${pushCommentVersions.commentId} = ${comment.id}::uuid AND ${pushCommentVersions.version} = ${comment.currentVersion}`,
          )
          .limit(1);
    return {
      comment: toCommentDto(comment, version ?? null, input.actorId),
      idempotentReplay: true,
    };
  }

  const replay = await findAuditReplay(db, auditKey);
  if (replay) {
    assertAuditReplayMatch({
      replay,
      expectedResourceId: input.commentId,
      payloadHash,
      conflictMessage: "Comment mutate idempotency payload mismatch",
    });
    return loadCommentReplay(db, replay.resourceId);
  }

  return db.transaction(async (tx) => {
    const replayInTx = await findAuditReplay(tx, auditKey);
    if (replayInTx) {
      assertAuditReplayMatch({
        replay: replayInTx,
        expectedResourceId: input.commentId,
        payloadHash,
        conflictMessage: "Comment mutate idempotency payload mismatch",
      });
      return loadCommentReplay(tx, replayInTx.resourceId);
    }

    await tx.execute(sql`SELECT id FROM push_comments WHERE id = ${input.commentId} FOR UPDATE`);
    const [comment] = await tx
      .select()
      .from(pushComments)
      .where(eq(pushComments.id, input.commentId))
      .limit(1);
    if (!comment) {
      throw new FamilyContentError("NOT_FOUND", "Comment not found");
    }
    if (comment.authorId !== input.actorId) {
      throw new FamilyContentError("FORBIDDEN", "Only the author can modify this comment");
    }
    if (comment.deletedAt) {
      throw new FamilyContentError("STATE_CONFLICT", "Comment is already deleted");
    }

    const push = await loadPushOrThrow(tx, comment.pushId);
    await assertStudentNotFrozenForFamilyContent(tx, push.studentId, "write");
    if (!COMMENTABLE_STATUSES.has(push.status as "published") && !input.delete) {
      throw new FamilyContentError("STATE_CONFLICT", "Push does not accept comment edits");
    }

    // Ensure author still has access (student target or linked parent).
    await assertCanAccessPush(tx, {
      actorId: input.actorId,
      actorRole: input.actorId === push.studentId ? "student" : "parent",
      push,
    });

    const now = input.now ?? new Date();

    if (input.delete) {
      const [updated] = await tx
        .update(pushComments)
        .set({ deletedAt: now, updatedAt: now })
        .where(eq(pushComments.id, comment.id))
        .returning();

      await appendAuditEvent(tx, {
        actorId: input.actorId,
        action: "family_push.comment_deleted",
        resourceType: "push_comment",
        resourceId: comment.id,
        requestId: input.requestId ?? null,
        idempotencyKey: auditKey,
        metadata: {
          pushId: push.id,
          studentId: push.studentId,
          payloadHash,
        },
      });

      return { comment: toCommentDto(updated!, null, input.actorId), idempotentReplay: false };
    }

    if (!input.body) {
      throw new FamilyContentError("VALIDATION_ERROR", "Comment body is required");
    }
    const body = normalizeCommentBody(input.body);
    const nextVersion = comment.currentVersion + 1;

    const [updated] = await tx
      .update(pushComments)
      .set({ currentVersion: nextVersion, updatedAt: now })
      .where(eq(pushComments.id, comment.id))
      .returning();

    const [version] = await tx
      .insert(pushCommentVersions)
      .values({
        commentId: comment.id,
        version: nextVersion,
        body,
        mutateIdempotencyKey: input.idempotencyKey,
        mutateIdempotencyPayloadHash: payloadHash,
        createdAt: now,
      })
      .returning();

    await appendAuditEvent(tx, {
      actorId: input.actorId,
      action: "family_push.comment_edited",
      resourceType: "push_comment",
      resourceId: comment.id,
      requestId: input.requestId ?? null,
      idempotencyKey: auditKey,
      metadata: {
        pushId: push.id,
        studentId: push.studentId,
        version: nextVersion,
        bodyLength: body.length,
        payloadHash,
      },
    });

    return { comment: toCommentDto(updated!, version!, input.actorId), idempotentReplay: false };
  });
}
