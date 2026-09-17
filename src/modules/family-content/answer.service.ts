import { asc, and, eq, inArray, sql } from "drizzle-orm";

import type { Database } from "@/db";
import { familyPushes, pushAnswerVersions, pushAnswers, users } from "@/db/schema";
import { appendAuditEvent } from "@/modules/audit/append-audit-event";
import {
  assertStudentNotFrozenForFamilyContent,
  loadPushOrThrow,
} from "@/modules/family-content/access";
import {
  ANSWERABLE_STATUSES,
  FAMILY_CONTENT_EVENT_TYPES,
} from "@/modules/family-content/constants";
import { normalizeAnswerContent } from "@/modules/family-content/content";
import type { PushAnswerDto } from "@/modules/family-content/dto";
import { FamilyContentError } from "@/modules/family-content/errors";
import {
  attachReadyMediaToResource,
  listActiveMediaDtosForResource,
} from "@/modules/family-content/media-reference.service";
import { appendOutboxEvent } from "@/modules/outbox/append-outbox-event";
import { hashIdempotencyPayload } from "@/modules/schedule/normalize-idempotency-payload";
import { isAnswerDisclosed, relatedPushesForStudentRead } from "./answer-disclosure.service";

/** Own answers remain editable for 10 calendar days after first creation. */
export const ANSWER_EDIT_WINDOW_MS = 10 * 24 * 60 * 60 * 1000;

export function isAnswerWithinEditWindow(createdAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - createdAt.getTime() <= ANSWER_EDIT_WINDOW_MS;
}

async function toAnswerDto(
  db: Database,
  answer: typeof pushAnswers.$inferSelect,
  version: typeof pushAnswerVersions.$inferSelect,
  viewerId?: string,
  now: Date = new Date(),
): Promise<PushAnswerDto> {
  const media = await listActiveMediaDtosForResource(db, "push_answer_version", version.id);
  const [author] = await db.select({ displayName: users.displayName }).from(users).where(eq(users.id, answer.studentId)).limit(1);
  const edited = answer.currentVersion > 1;
  const canEdit =
    viewerId === answer.studentId && isAnswerWithinEditWindow(answer.createdAt, now);
  return {
    answerId: answer.id,
    pushId: answer.pushId,
    studentId: answer.studentId,
    authorName: author?.displayName ?? "学生",
    currentVersion: answer.currentVersion,
    body: version.body,
    media,
    edited,
    canEdit,
    createdAt: answer.createdAt.toISOString(),
    updatedAt: answer.updatedAt.toISOString(),
  };
}

export async function getPushAnswer(db: Database, pushId: string): Promise<PushAnswerDto | null> {
  const answers = await listPushAnswers(db, pushId);
  return answers.at(-1) ?? null;
}

/** Answers are attempts, not revisions of a single attempt. Edits bump version on one attempt. */
export async function listPushAnswers(db: Database, pushId: string, viewer?: { actorId: string; actorRole: "parent" | "student" }): Promise<PushAnswerDto[]> {
  const related = viewer?.actorRole === "student" ? await relatedPushesForStudentRead(db, pushId) : null;
  const visibleIds = related ? related.filter((push) => isAnswerDisclosed(push, viewer!.actorId)).map((push) => push.id) : [pushId];
  const answers = await db
    .select()
    .from(pushAnswers)
    .where(inArray(pushAnswers.pushId, visibleIds))
    .orderBy(asc(pushAnswers.createdAt));
  const result: PushAnswerDto[] = [];
  const now = new Date();
  for (const answer of answers) {
    const [version] = await db.select().from(pushAnswerVersions).where(
      sql`${pushAnswerVersions.answerId} = ${answer.id}::uuid AND ${pushAnswerVersions.version} = ${answer.currentVersion}`,
    ).limit(1);
    if (version) result.push(await toAnswerDto(db, answer, version, viewer?.actorId, now));
  }
  return result;
}

export type SubmitPushAnswerInput = {
  studentId: string;
  pushId: string;
  body?: string | null;
  mediaIds?: string[] | null;
  handwritingMediaIds?: string[] | null;
  idempotencyKey: string;
  requestId?: string;
  now?: Date;
};

async function attachAnswerMedia(
  tx: Database,
  input: {
    studentId: string;
    versionId: string;
    mediaIds: string[];
    handwritingMediaIds: string[];
    now: Date;
  },
): Promise<void> {
  for (const mediaId of input.mediaIds) {
    await attachReadyMediaToResource(tx, {
      actorId: input.studentId,
      mediaId,
      resourceType: "push_answer_version",
      resourceId: input.versionId,
      purpose: "answer_image",
      studentId: input.studentId,
      now: input.now,
    });
  }
  for (const mediaId of input.handwritingMediaIds) {
    await attachReadyMediaToResource(tx, {
      actorId: input.studentId,
      mediaId,
      resourceType: "push_answer_version",
      resourceId: input.versionId,
      purpose: "handwriting_image",
      studentId: input.studentId,
      now: input.now,
    });
  }
}

export async function submitPushAnswer(
  db: Database,
  input: SubmitPushAnswerInput,
): Promise<{ answer: PushAnswerDto; idempotentReplay: boolean }> {
  const content = normalizeAnswerContent({
    body: input.body,
    mediaIds: input.mediaIds,
    handwritingMediaIds: input.handwritingMediaIds,
  });
  const payloadHash = hashIdempotencyPayload({
    pushId: input.pushId,
    body: content.body,
    mediaIds: content.mediaIds,
    handwritingMediaIds: content.handwritingMediaIds,
  });

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM family_pushes WHERE id = ${input.pushId} FOR UPDATE`);
    const push = await loadPushOrThrow(tx, input.pushId);
    await assertStudentNotFrozenForFamilyContent(tx, push.studentId, "write");

    if (input.studentId !== push.studentId) {
      throw new FamilyContentError("FORBIDDEN", "Access denied");
    }
    if (!ANSWERABLE_STATUSES.has(push.status as "published")) {
      throw new FamilyContentError("STATE_CONFLICT", "Push does not accept answers");
    }

    const [existingAnswer] = await tx
      .select()
      .from(pushAnswers)
      .where(and(eq(pushAnswers.studentId, input.studentId), eq(pushAnswers.createIdempotencyKey, input.idempotencyKey)))
      .limit(1);

    if (existingAnswer) {
      if (existingAnswer.pushId !== push.id) {
        throw new FamilyContentError("IDEMPOTENCY_CONFLICT", "Answer idempotency payload mismatch");
      }
      const [replayVersion] = await tx
        .select()
        .from(pushAnswerVersions)
        .where(
          sql`${pushAnswerVersions.answerId} = ${existingAnswer.id}::uuid AND ${pushAnswerVersions.submitIdempotencyKey} = ${input.idempotencyKey}`,
        )
        .limit(1);

      if (replayVersion) {
        if (replayVersion.submitIdempotencyPayloadHash !== payloadHash) {
          throw new FamilyContentError(
            "IDEMPOTENCY_CONFLICT",
            "Answer idempotency payload mismatch",
          );
        }
        const [current] = await tx
          .select()
          .from(pushAnswerVersions)
          .where(
            sql`${pushAnswerVersions.answerId} = ${existingAnswer.id}::uuid AND ${pushAnswerVersions.version} = ${existingAnswer.currentVersion}`,
          )
          .limit(1);
        return {
          answer: await toAnswerDto(tx, existingAnswer, current ?? replayVersion, input.studentId),
          idempotentReplay: true,
        };
      }

      throw new FamilyContentError("STATE_CONFLICT", "Answer idempotency replay record is incomplete");
    }

    const now = input.now ?? new Date();
    const [answer] = await tx
      .insert(pushAnswers)
      .values({
        pushId: push.id,
        studentId: input.studentId,
        currentVersion: 1,
        createIdempotencyKey: input.idempotencyKey,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    const [version] = await tx
      .insert(pushAnswerVersions)
      .values({
        answerId: answer!.id,
        version: 1,
        body: content.body,
        submitIdempotencyKey: input.idempotencyKey,
        submitIdempotencyPayloadHash: payloadHash,
        createdAt: now,
      })
      .returning();

    await attachAnswerMedia(tx, {
      studentId: input.studentId,
      versionId: version!.id,
      mediaIds: content.mediaIds,
      handwritingMediaIds: content.handwritingMediaIds,
      now,
    });

    await appendAuditEvent(tx, {
      actorId: input.studentId,
      action: "family_push.answered",
      resourceType: "push_answer",
      resourceId: answer!.id,
      requestId: input.requestId ?? null,
      idempotencyKey: `audit:push-answer:${input.idempotencyKey}`,
      metadata: {
        pushId: push.id,
        studentId: push.studentId,
        version: 1,
        bodyLength: content.body.length,
        mediaCount: content.mediaIds.length + content.handwritingMediaIds.length,
      },
    });

    await appendOutboxEvent(tx, {
      aggregateType: "family_push",
      aggregateId: push.id,
      eventType: FAMILY_CONTENT_EVENT_TYPES.ANSWERED,
      dedupeKey: `family_push.answered:${answer!.id}:v1`,
      payload: {
        pushId: push.id,
        answerId: answer!.id,
        studentId: push.studentId,
        version: 1,
      },
    });

    await tx.update(familyPushes).set({ updatedAt: now }).where(eq(familyPushes.id, push.id));

    return { answer: await toAnswerDto(tx, answer!, version!, input.studentId), idempotentReplay: false };
  });
}

export type EditPushAnswerInput = {
  studentId: string;
  answerId: string;
  body?: string | null;
  mediaIds?: string[] | null;
  handwritingMediaIds?: string[] | null;
  idempotencyKey: string;
  requestId?: string;
  now?: Date;
};

export async function editPushAnswer(
  db: Database,
  input: EditPushAnswerInput,
): Promise<{ answer: PushAnswerDto; idempotentReplay: boolean }> {
  const content = normalizeAnswerContent({
    body: input.body,
    mediaIds: input.mediaIds,
    handwritingMediaIds: input.handwritingMediaIds,
  });
  const payloadHash = hashIdempotencyPayload({
    answerId: input.answerId,
    body: content.body,
    mediaIds: content.mediaIds,
    handwritingMediaIds: content.handwritingMediaIds,
  });
  const auditKey = `audit:push-answer-edited:${input.idempotencyKey}`;

  return db.transaction(async (tx) => {
    const [answer] = await tx
      .select()
      .from(pushAnswers)
      .where(eq(pushAnswers.id, input.answerId))
      .limit(1);
    if (!answer) {
      throw new FamilyContentError("NOT_FOUND", "Answer not found");
    }
    if (answer.studentId !== input.studentId) {
      throw new FamilyContentError("FORBIDDEN", "Only the author can edit this answer");
    }

    await tx.execute(sql`SELECT id FROM family_pushes WHERE id = ${answer.pushId} FOR UPDATE`);
    const push = await loadPushOrThrow(tx, answer.pushId);
    await assertStudentNotFrozenForFamilyContent(tx, push.studentId, "write");
    if (!ANSWERABLE_STATUSES.has(push.status as "published")) {
      throw new FamilyContentError("STATE_CONFLICT", "Push does not accept answer edits");
    }

    const now = input.now ?? new Date();
    if (!isAnswerWithinEditWindow(answer.createdAt, now)) {
      throw new FamilyContentError("STATE_CONFLICT", "作答已超过 10 天，不可再编辑");
    }

    const [replayVersion] = await tx
      .select()
      .from(pushAnswerVersions)
      .where(
        sql`${pushAnswerVersions.answerId} = ${answer.id}::uuid AND ${pushAnswerVersions.submitIdempotencyKey} = ${input.idempotencyKey}`,
      )
      .limit(1);
    if (replayVersion) {
      if (replayVersion.submitIdempotencyPayloadHash !== payloadHash) {
        throw new FamilyContentError("IDEMPOTENCY_CONFLICT", "Answer edit idempotency payload mismatch");
      }
      const [current] = await tx
        .select()
        .from(pushAnswerVersions)
        .where(
          sql`${pushAnswerVersions.answerId} = ${answer.id}::uuid AND ${pushAnswerVersions.version} = ${answer.currentVersion}`,
        )
        .limit(1);
      return {
        answer: await toAnswerDto(tx, answer, current ?? replayVersion, input.studentId, now),
        idempotentReplay: true,
      };
    }

    const nextVersion = answer.currentVersion + 1;
    const [updated] = await tx
      .update(pushAnswers)
      .set({ currentVersion: nextVersion, updatedAt: now })
      .where(eq(pushAnswers.id, answer.id))
      .returning();

    const [version] = await tx
      .insert(pushAnswerVersions)
      .values({
        answerId: answer.id,
        version: nextVersion,
        body: content.body,
        submitIdempotencyKey: input.idempotencyKey,
        submitIdempotencyPayloadHash: payloadHash,
        createdAt: now,
      })
      .returning();

    await attachAnswerMedia(tx, {
      studentId: input.studentId,
      versionId: version!.id,
      mediaIds: content.mediaIds,
      handwritingMediaIds: content.handwritingMediaIds,
      now,
    });

    await appendAuditEvent(tx, {
      actorId: input.studentId,
      action: "family_push.answer_edited",
      resourceType: "push_answer",
      resourceId: answer.id,
      requestId: input.requestId ?? null,
      idempotencyKey: auditKey,
      metadata: {
        pushId: push.id,
        studentId: push.studentId,
        version: nextVersion,
        bodyLength: content.body.length,
        mediaCount: content.mediaIds.length + content.handwritingMediaIds.length,
        payloadHash,
      },
    });

    await appendOutboxEvent(tx, {
      aggregateType: "family_push",
      aggregateId: push.id,
      eventType: FAMILY_CONTENT_EVENT_TYPES.ANSWERED,
      dedupeKey: `family_push.answered:${answer.id}:v${nextVersion}`,
      payload: {
        pushId: push.id,
        answerId: answer.id,
        studentId: push.studentId,
        version: nextVersion,
        edited: true,
      },
    });

    await tx.update(familyPushes).set({ updatedAt: now }).where(eq(familyPushes.id, push.id));

    return { answer: await toAnswerDto(tx, updated!, version!, input.studentId, now), idempotentReplay: false };
  });
}
