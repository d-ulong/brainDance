import { eq, sql } from "drizzle-orm";

import type { Database } from "@/db";
import { familyPushes, pushAnswerVersions, pushAnswers } from "@/db/schema";
import { appendAuditEvent } from "@/modules/audit/append-audit-event";
import {
  assertStudentNotFrozenForFamilyContent,
  loadPushOrThrow,
} from "@/modules/family-content/access";
import {
  ANSWERABLE_STATUSES,
  FAMILY_CONTENT_EVENT_TYPES,
} from "@/modules/family-content/constants";
import { normalizeAnswerBody } from "@/modules/family-content/content";
import type { PushAnswerDto } from "@/modules/family-content/dto";
import { FamilyContentError } from "@/modules/family-content/errors";
import { appendOutboxEvent } from "@/modules/outbox/append-outbox-event";
import { hashIdempotencyPayload } from "@/modules/schedule/normalize-idempotency-payload";

function toAnswerDto(
  answer: typeof pushAnswers.$inferSelect,
  version: typeof pushAnswerVersions.$inferSelect,
): PushAnswerDto {
  return {
    answerId: answer.id,
    pushId: answer.pushId,
    studentId: answer.studentId,
    currentVersion: answer.currentVersion,
    body: version.body,
    updatedAt: answer.updatedAt.toISOString(),
  };
}

export async function getPushAnswer(db: Database, pushId: string): Promise<PushAnswerDto | null> {
  const [answer] = await db
    .select()
    .from(pushAnswers)
    .where(eq(pushAnswers.pushId, pushId))
    .limit(1);
  if (!answer) {
    return null;
  }
  const [version] = await db
    .select()
    .from(pushAnswerVersions)
    .where(
      sql`${pushAnswerVersions.answerId} = ${answer.id}::uuid AND ${pushAnswerVersions.version} = ${answer.currentVersion}`,
    )
    .limit(1);
  if (!version) {
    return null;
  }
  return toAnswerDto(answer, version);
}

export type SubmitPushAnswerInput = {
  studentId: string;
  pushId: string;
  body: string;
  idempotencyKey: string;
  requestId?: string;
  now?: Date;
};

export async function submitPushAnswer(
  db: Database,
  input: SubmitPushAnswerInput,
): Promise<{ answer: PushAnswerDto; idempotentReplay: boolean }> {
  const body = normalizeAnswerBody(input.body);
  const payloadHash = hashIdempotencyPayload({ body });

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
      .where(eq(pushAnswers.pushId, push.id))
      .limit(1);

    if (existingAnswer) {
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
          answer: toAnswerDto(existingAnswer, current ?? replayVersion),
          idempotentReplay: true,
        };
      }

      await tx.execute(sql`SELECT id FROM push_answers WHERE id = ${existingAnswer.id} FOR UPDATE`);
      const now = input.now ?? new Date();
      const nextVersion = existingAnswer.currentVersion + 1;
      const [updated] = await tx
        .update(pushAnswers)
        .set({ currentVersion: nextVersion, updatedAt: now })
        .where(eq(pushAnswers.id, existingAnswer.id))
        .returning();

      const [version] = await tx
        .insert(pushAnswerVersions)
        .values({
          answerId: existingAnswer.id,
          version: nextVersion,
          body,
          submitIdempotencyKey: input.idempotencyKey,
          submitIdempotencyPayloadHash: payloadHash,
          createdAt: now,
        })
        .returning();

      await appendAuditEvent(tx, {
        actorId: input.studentId,
        action: "family_push.answered",
        resourceType: "push_answer",
        resourceId: existingAnswer.id,
        requestId: input.requestId ?? null,
        idempotencyKey: `audit:push-answer:${input.idempotencyKey}`,
        metadata: {
          pushId: push.id,
          studentId: push.studentId,
          version: nextVersion,
          bodyLength: body.length,
        },
      });

      await appendOutboxEvent(tx, {
        aggregateType: "family_push",
        aggregateId: push.id,
        eventType: FAMILY_CONTENT_EVENT_TYPES.ANSWERED,
        dedupeKey: `family_push.answered:${existingAnswer.id}:v${nextVersion}`,
        payload: {
          pushId: push.id,
          answerId: existingAnswer.id,
          studentId: push.studentId,
          version: nextVersion,
        },
      });

      return { answer: toAnswerDto(updated!, version!), idempotentReplay: false };
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
        body,
        submitIdempotencyKey: input.idempotencyKey,
        submitIdempotencyPayloadHash: payloadHash,
        createdAt: now,
      })
      .returning();

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
        bodyLength: body.length,
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

    // Touch push updated_at for list ordering without changing status.
    await tx.update(familyPushes).set({ updatedAt: now }).where(eq(familyPushes.id, push.id));

    return { answer: toAnswerDto(answer!, version!), idempotentReplay: false };
  });
}
