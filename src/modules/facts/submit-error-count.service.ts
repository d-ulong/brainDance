import { and, eq } from "drizzle-orm";

import type { Database } from "@/db";
import { factVersions } from "@/db/schema";
import { appendAuditEvent } from "@/modules/audit/append-audit-event";
import { FactsError } from "@/modules/facts/errors";
import { appendOutboxEvent } from "@/modules/outbox/append-outbox-event";
import { isPostgresUniqueViolation } from "@/lib/postgres-errors";
import { hashIdempotencyPayload } from "@/modules/schedule/normalize-idempotency-payload";
import { assertFormalScheduleItem } from "@/modules/settlement/error-count-settlement.service";

export type SubmitErrorCountInput = {
  actorId: string;
  scheduleItemId: string;
  idempotencyKey: string;
  body: { errorCount: number; assertedAt?: string };
  now?: Date;
  requestId?: string;
};

export type SubmitErrorCountResult = {
  factVersionId: string;
  scheduleItemId: string;
  errorCount: number;
  idempotentReplay: boolean;
};

function buildPayloadHash(body: { errorCount: number; assertedAt?: string }): string {
  return hashIdempotencyPayload(body);
}

async function loadSubmitReplay(
  tx: Database,
  scheduleItemId: string,
  idempotencyKey: string,
): Promise<SubmitErrorCountResult> {
  const [fact] = await tx
    .select()
    .from(factVersions)
    .where(
      and(
        eq(factVersions.scheduleItemId, scheduleItemId),
        eq(factVersions.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);

  if (!fact) {
    throw new FactsError("STATE_CONFLICT", "Submit replay fact missing");
  }

  const errorCount = (fact.value as { error_count: number }).error_count;

  return {
    factVersionId: fact.id,
    scheduleItemId,
    errorCount,
    idempotentReplay: true,
  };
}

export async function submitErrorCount(
  db: Database,
  input: SubmitErrorCountInput,
): Promise<SubmitErrorCountResult> {
  const now = input.now ?? new Date();

  if (!Number.isInteger(input.body.errorCount) || input.body.errorCount < 0) {
    throw new FactsError("VALIDATION_ERROR", "errorCount must be a non-negative integer");
  }

  const payloadHash = buildPayloadHash(input.body);
  const assertedAt = input.body.assertedAt ? new Date(input.body.assertedAt) : now;

  if (Number.isNaN(assertedAt.getTime())) {
    throw new FactsError("VALIDATION_ERROR", "assertedAt is invalid");
  }

  try {
    return await db.transaction(async (tx) => {
      const item = await assertFormalScheduleItem(tx, input.scheduleItemId);

      if (item.studentId !== input.actorId) {
        throw new FactsError("FORBIDDEN", "Only the student can submit error_count facts");
      }

      const [existing] = await tx
        .select()
        .from(factVersions)
        .where(
          and(
            eq(factVersions.scheduleItemId, input.scheduleItemId),
            eq(factVersions.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);

      if (existing) {
        if (existing.idempotencyPayloadHash !== payloadHash) {
          throw new FactsError(
            "IDEMPOTENCY_CONFLICT",
            "Submit error_count idempotency payload mismatch",
          );
        }
        return loadSubmitReplay(tx, input.scheduleItemId, input.idempotencyKey);
      }

      const [fact] = await tx
        .insert(factVersions)
        .values({
          scheduleItemId: item.id,
          studentId: item.studentId,
          factKey: "schedule.error_count",
          sourceKind: "manual",
          value: { error_count: input.body.errorCount },
          idempotencyKey: input.idempotencyKey,
          idempotencyPayloadHash: payloadHash,
          completionKind: "not_applicable",
          occurredAt: assertedAt,
          assertedAt,
          recordedAt: now,
          submittedBy: input.actorId,
        })
        .returning();

      if (!fact) {
        throw new Error("Failed to create error_count fact");
      }

      await appendAuditEvent(tx, {
        actorId: input.actorId,
        action: "fact.error_count.submitted",
        resourceType: "fact_version",
        resourceId: fact.id,
        requestId: input.requestId ?? null,
        idempotencyKey: `audit:fact-error-count-submitted:${input.idempotencyKey}`,
        metadata: { scheduleItemId: item.id, errorCount: input.body.errorCount },
      });

      await appendOutboxEvent(tx, {
        aggregateType: "fact",
        aggregateId: fact.id,
        eventType: "fact.submitted",
        dedupeKey: `fact.submitted:${fact.id}`,
        payload: { factVersionId: fact.id, scheduleItemId: item.id },
      });

      return {
        factVersionId: fact.id,
        scheduleItemId: item.id,
        errorCount: input.body.errorCount,
        idempotentReplay: false,
      };
    });
  } catch (error) {
    if (isPostgresUniqueViolation(error)) {
      const replay = await db.transaction(async (tx) => {
        const [raced] = await tx
          .select()
          .from(factVersions)
          .where(
            and(
              eq(factVersions.scheduleItemId, input.scheduleItemId),
              eq(factVersions.idempotencyKey, input.idempotencyKey),
            ),
          )
          .limit(1);

        if (!raced) {
          throw error;
        }

        if (raced.idempotencyPayloadHash !== payloadHash) {
          throw new FactsError(
            "IDEMPOTENCY_CONFLICT",
            "Submit error_count idempotency payload mismatch",
          );
        }

        return loadSubmitReplay(tx, input.scheduleItemId, input.idempotencyKey);
      });
      return replay;
    }
    throw error;
  }
}
