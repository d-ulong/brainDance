import { and, eq, sql } from "drizzle-orm";

import type { Database } from "@/db";
import { factVersions } from "@/db/schema";
import { appendAuditEvent } from "@/modules/audit/append-audit-event";
import { requireActiveRelationship } from "@/modules/family-access/authorization.service";
import { FamilyAccessError } from "@/modules/family-access/errors";
import { FactsError } from "@/modules/facts/errors";
import { appendOutboxEvent } from "@/modules/outbox/append-outbox-event";
import { settleForErrorCountFact } from "@/modules/settlement/error-count-settlement.service";

export type ConfirmFactInput = {
  parentId: string;
  factId: string;
  idempotencyKey: string;
  now?: Date;
  requestId?: string;
};

export type ConfirmFactResult = {
  factVersionId: string;
  settlementId: string;
  ledgerEntryId: string;
  idempotentReplay: boolean;
};

async function lockFact(tx: Database, factId: string) {
  await tx.execute(sql`SELECT id FROM fact_versions WHERE id = ${factId}::uuid FOR UPDATE`);

  const [fact] = await tx
    .select()
    .from(factVersions)
    .where(eq(factVersions.id, factId))
    .limit(1);

  if (!fact) {
    throw new FactsError("NOT_FOUND", "Fact not found");
  }

  return fact;
}

async function loadConfirmReplay(
  tx: Database,
  factId: string,
): Promise<ConfirmFactResult> {
  const settlement = await settleForErrorCountFact(tx, { factVersionId: factId });
  return {
    factVersionId: factId,
    settlementId: settlement.settlementId,
    ledgerEntryId: settlement.ledgerEntryId,
    idempotentReplay: true,
  };
}

export async function confirmFact(
  db: Database,
  input: ConfirmFactInput,
): Promise<ConfirmFactResult> {
  const now = input.now ?? new Date();

  return db.transaction(async (tx) => {
    const fact = await lockFact(tx, input.factId);

    if (fact.factKey !== "schedule.error_count" || fact.sourceKind !== "manual") {
      throw new FactsError("VALIDATION_ERROR", "Only manual error_count facts can be confirmed");
    }

    if (fact.supersedesFactVersionId) {
      throw new FactsError("STATE_CONFLICT", "Cannot confirm a correction successor directly");
    }

    if (fact.voidedAt) {
      throw new FactsError("STATE_CONFLICT", "Fact has been voided");
    }

    try {
      await requireActiveRelationship(tx, input.parentId, fact.studentId);
    } catch (error) {
      if (error instanceof FamilyAccessError && error.code === "FORBIDDEN") {
        throw new FactsError("FORBIDDEN", error.message);
      }
      throw error;
    }

    if (fact.confirmedAt && fact.confirmedBy) {
      return loadConfirmReplay(tx, fact.id);
    }

    await tx
      .update(factVersions)
      .set({ confirmedAt: now, confirmedBy: input.parentId })
      .where(eq(factVersions.id, fact.id));

    const settlement = await settleForErrorCountFact(tx, { factVersionId: fact.id });

    await appendAuditEvent(tx, {
      actorId: input.parentId,
      action: "fact.confirmed",
      resourceType: "fact_version",
      resourceId: fact.id,
      requestId: input.requestId ?? null,
      idempotencyKey: `audit:fact-confirmed:${input.idempotencyKey}`,
      metadata: { settlementId: settlement.settlementId },
    });

    await appendOutboxEvent(tx, {
      aggregateType: "fact",
      aggregateId: fact.id,
      eventType: "fact.confirmed",
      dedupeKey: `fact.confirmed:${fact.id}:${input.idempotencyKey}`,
      payload: {
        factVersionId: fact.id,
        settlementId: settlement.settlementId,
        ledgerEntryId: settlement.ledgerEntryId,
      },
    });

    return {
      factVersionId: fact.id,
      settlementId: settlement.settlementId,
      ledgerEntryId: settlement.ledgerEntryId,
      idempotentReplay: false,
    };
  });
}
