import { eq, sql } from "drizzle-orm";

import type { Database } from "@/db";
import { dailyReflectionVersions, dailyReflections } from "@/db/schema";
import { appendAuditEvent } from "@/modules/audit/append-audit-event";
import type { ReflectionVisibility } from "@/modules/reflection-privacy/constants";
import { ReflectionPrivacyError } from "@/modules/reflection-privacy/errors";
import { assertStudentAccountNotFrozen } from "@/modules/data-lifecycle/freeze-guard.service";
import {
  assertEditableFamilyDate,
  findReflectionByStudentDate,
  findReflectionReplayByAudit,
  type DailyReflectionDto,
} from "@/modules/reflection-privacy/get-daily-reflection.service";
import { appendOutboxEvent } from "@/modules/outbox/append-outbox-event";

export type UpsertDailyReflectionInput = {
  studentId: string;
  familyDate: string;
  body: string;
  visibility: ReflectionVisibility;
  idempotencyKey: string;
  requestId?: string;
};

export type UpsertDailyReflectionResult = {
  reflection: DailyReflectionDto;
  idempotentReplay: boolean;
};

function toDto(reflection: typeof dailyReflections.$inferSelect): DailyReflectionDto {
  return {
    reflectionId: reflection.id,
    studentId: reflection.studentId,
    familyDate: reflection.familyDate,
    visibility: reflection.visibility,
    body: reflection.body,
    currentVersion: reflection.currentVersion,
    updatedAt: reflection.updatedAt.toISOString(),
  };
}

export async function upsertDailyReflection(
  db: Database,
  input: UpsertDailyReflectionInput,
): Promise<UpsertDailyReflectionResult> {
  const trimmedBody = input.body.trim();
  if (trimmedBody.length === 0) {
    throw new ReflectionPrivacyError("VALIDATION_ERROR", "Reflection body is required");
  }
  if (trimmedBody.length > 10_000) {
    throw new ReflectionPrivacyError("VALIDATION_ERROR", "Reflection body is too long");
  }

  assertEditableFamilyDate(input.familyDate);

  await assertStudentAccountNotFrozen(db, input.studentId, "write");

  const replayId = await findReflectionReplayByAudit(db, input.idempotencyKey, "reflection.upsert");
  if (replayId) {
    const [reflection] = await db
      .select()
      .from(dailyReflections)
      .where(eq(dailyReflections.id, replayId))
      .limit(1);
    if (!reflection) {
      throw new ReflectionPrivacyError("NOT_FOUND", "Daily reflection not found");
    }
    return { reflection: toDto(reflection), idempotentReplay: true };
  }

  return db.transaction(async (tx) => {
    const replayInTx = await findReflectionReplayByAudit(
      tx,
      input.idempotencyKey,
      "reflection.upsert",
    );
    if (replayInTx) {
      const [reflection] = await tx
        .select()
        .from(dailyReflections)
        .where(eq(dailyReflections.id, replayInTx))
        .limit(1);
      if (!reflection) {
        throw new ReflectionPrivacyError("NOT_FOUND", "Daily reflection not found");
      }
      return { reflection: toDto(reflection), idempotentReplay: true };
    }

    await tx.execute(sql`SELECT id FROM users WHERE id = ${input.studentId} FOR UPDATE`);

    const existing = await findReflectionByStudentDate(tx, input.studentId, input.familyDate);

    if (existing) {
      if (existing.visibility === "normal" && input.visibility === "private") {
        throw new ReflectionPrivacyError(
          "STATE_CONFLICT",
          "Normal reflections cannot be changed to private",
        );
      }

      const nextVersion = existing.currentVersion + 1;
      const nextVisibility =
        existing.visibility === "private" && input.visibility === "normal"
          ? "normal"
          : existing.visibility;

      const [updated] = await tx
        .update(dailyReflections)
        .set({
          body: trimmedBody,
          visibility: nextVisibility,
          currentVersion: nextVersion,
          upsertIdempotencyKey: input.idempotencyKey,
          updatedAt: new Date(),
        })
        .where(eq(dailyReflections.id, existing.id))
        .returning();

      if (!updated) {
        throw new ReflectionPrivacyError("NOT_FOUND", "Daily reflection not found");
      }

      await tx.insert(dailyReflectionVersions).values({
        reflectionId: updated.id,
        version: nextVersion,
        visibility: nextVisibility,
        body: trimmedBody,
      });

      await appendAuditEvent(tx, {
        actorId: input.studentId,
        action: "reflection.upsert",
        resourceType: "daily_reflection",
        resourceId: updated.id,
        requestId: input.requestId,
        idempotencyKey: `audit:reflection.upsert:${input.idempotencyKey}`,
        metadata: {
          studentId: input.studentId,
          familyDate: input.familyDate,
          visibility: nextVisibility,
          version: nextVersion,
        },
      });

      await appendOutboxEvent(tx, {
        aggregateType: "daily_reflection",
        aggregateId: updated.id,
        eventType: "reflection.updated",
        dedupeKey: `outbox:reflection.upsert:${input.idempotencyKey}`,
        payload: {
          reflectionId: updated.id,
          studentId: input.studentId,
          familyDate: input.familyDate,
          visibility: nextVisibility,
        },
      });

      return { reflection: toDto(updated), idempotentReplay: false };
    }

    const [created] = await tx
      .insert(dailyReflections)
      .values({
        studentId: input.studentId,
        familyDate: input.familyDate,
        visibility: input.visibility,
        body: trimmedBody,
        currentVersion: 1,
        upsertIdempotencyKey: input.idempotencyKey,
      })
      .returning();

    if (!created) {
      throw new ReflectionPrivacyError("STATE_CONFLICT", "Failed to create reflection");
    }

    await tx.insert(dailyReflectionVersions).values({
      reflectionId: created.id,
      version: 1,
      visibility: input.visibility,
      body: trimmedBody,
    });

    await appendAuditEvent(tx, {
      actorId: input.studentId,
      action: "reflection.upsert",
      resourceType: "daily_reflection",
      resourceId: created.id,
      requestId: input.requestId,
      idempotencyKey: `audit:reflection.upsert:${input.idempotencyKey}`,
      metadata: {
        studentId: input.studentId,
        familyDate: input.familyDate,
        visibility: input.visibility,
        version: 1,
      },
    });

    await appendOutboxEvent(tx, {
      aggregateType: "daily_reflection",
      aggregateId: created.id,
      eventType: "reflection.created",
      dedupeKey: `outbox:reflection.upsert:${input.idempotencyKey}`,
      payload: {
        reflectionId: created.id,
        studentId: input.studentId,
        familyDate: input.familyDate,
        visibility: input.visibility,
      },
    });

    return { reflection: toDto(created), idempotentReplay: false };
  });
}
