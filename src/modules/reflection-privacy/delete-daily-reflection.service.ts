import { and, eq, isNull, sql } from "drizzle-orm";

import type { Database } from "@/db";
import { dailyReflections, privateAccessGrants } from "@/db/schema";
import { appendAuditEvent } from "@/modules/audit/append-audit-event";
import { PRIVATE_RESOURCE_TYPES } from "@/modules/reflection-privacy/constants";
import { ReflectionPrivacyError } from "@/modules/reflection-privacy/errors";
import {
  assertEditableFamilyDate,
  findReflectionByStudentDate,
  findReflectionReplayByAudit,
} from "@/modules/reflection-privacy/get-daily-reflection.service";
import { appendOutboxEvent } from "@/modules/outbox/append-outbox-event";

export type DeleteDailyReflectionInput = {
  studentId: string;
  familyDate: string;
  idempotencyKey: string;
  requestId?: string;
};

export type DeleteDailyReflectionResult = {
  reflectionId: string;
  deleted: true;
  idempotentReplay: boolean;
};

export async function deleteDailyReflection(
  db: Database,
  input: DeleteDailyReflectionInput,
): Promise<DeleteDailyReflectionResult> {
  assertEditableFamilyDate(input.familyDate);

  const replayId = await findReflectionReplayByAudit(db, input.idempotencyKey, "reflection.delete");
  if (replayId) {
    return { reflectionId: replayId, deleted: true, idempotentReplay: true };
  }

  return db.transaction(async (tx) => {
    const replayInTx = await findReflectionReplayByAudit(
      tx,
      input.idempotencyKey,
      "reflection.delete",
    );
    if (replayInTx) {
      return { reflectionId: replayInTx, deleted: true, idempotentReplay: true };
    }

    await tx.execute(sql`SELECT id FROM users WHERE id = ${input.studentId} FOR UPDATE`);

    const existing = await findReflectionByStudentDate(tx, input.studentId, input.familyDate);
    if (!existing) {
      throw new ReflectionPrivacyError("NOT_FOUND", "Daily reflection not found");
    }

    const deletedAt = new Date();

    await tx
      .update(dailyReflections)
      .set({
        body: "",
        deletedAt,
        bodyPurgedAt: deletedAt,
        deleteIdempotencyKey: input.idempotencyKey,
        updatedAt: deletedAt,
      })
      .where(eq(dailyReflections.id, existing.id));

    await tx
      .update(privateAccessGrants)
      .set({ revokedAt: deletedAt })
      .where(
        and(
          eq(privateAccessGrants.resourceType, PRIVATE_RESOURCE_TYPES.DAILY_REFLECTION),
          eq(privateAccessGrants.resourceId, existing.id),
          isNull(privateAccessGrants.revokedAt),
        ),
      );

    await appendAuditEvent(tx, {
      actorId: input.studentId,
      action: "reflection.delete",
      resourceType: "daily_reflection",
      resourceId: existing.id,
      requestId: input.requestId,
      idempotencyKey: `audit:reflection.delete:${input.idempotencyKey}`,
      metadata: {
        studentId: input.studentId,
        familyDate: input.familyDate,
      },
    });

    await appendOutboxEvent(tx, {
      aggregateType: "daily_reflection",
      aggregateId: existing.id,
      eventType: "reflection.deleted",
      dedupeKey: `outbox:reflection.delete:${input.idempotencyKey}`,
      payload: {
        reflectionId: existing.id,
        studentId: input.studentId,
        familyDate: input.familyDate,
      },
    });

    return { reflectionId: existing.id, deleted: true, idempotentReplay: false };
  });
}
