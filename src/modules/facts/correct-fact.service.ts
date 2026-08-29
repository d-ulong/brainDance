import { and, eq, sql } from "drizzle-orm";

import type { Database } from "@/db";
import { factVersions } from "@/db/schema";
import { appendAuditEvent } from "@/modules/audit/append-audit-event";
import { requireActiveRelationship } from "@/modules/family-access/authorization.service";
import { FamilyAccessError } from "@/modules/family-access/errors";
import { FactsError } from "@/modules/facts/errors";
import { appendOutboxEvent } from "@/modules/outbox/append-outbox-event";
import { hashIdempotencyPayload } from "@/modules/schedule/normalize-idempotency-payload";
import {
  assertFormalScheduleItem,
  reverseLedgerEntriesForFact,
  settleForErrorCountFact,
} from "@/modules/settlement/error-count-settlement.service";
import { SettlementError } from "@/modules/settlement/errors";
import {
  isPastCorrectionWindow,
  isWithinCorrectionWindow,
} from "@/modules/time-policy/correction-window";
import { isPostgresUniqueViolation } from "@/lib/postgres-errors";

export type CorrectFactInput = {
  actorId: string;
  factId: string;
  idempotencyKey: string;
  body: { errorCount: number; reason: string };
  adminOverride?: { reason: "security" | "data_correction" };
  now?: Date;
  requestId?: string;
};

export type CorrectFactResult = {
  predecessorFactId: string;
  successorFactId: string;
  reversalLedgerEntryIds: string[];
  settlementId: string;
  ledgerEntryId: string;
  idempotentReplay: boolean;
};

const ADMIN_OVERRIDE_REASONS = new Set(["security", "data_correction"]);

async function lockFactChain(tx: Database, factId: string) {
  await tx.execute(sql`SELECT id FROM fact_versions WHERE id = ${factId}::uuid FOR UPDATE`);

  const [fact] = await tx.select().from(factVersions).where(eq(factVersions.id, factId)).limit(1);

  if (!fact) {
    throw new FactsError("NOT_FOUND", "Fact not found");
  }

  return fact;
}

async function loadCorrectReplay(
  tx: Database,
  predecessorId: string,
  idempotencyKey: string,
): Promise<CorrectFactResult> {
  const [successor] = await tx
    .select()
    .from(factVersions)
    .where(
      and(
        eq(factVersions.supersedesFactVersionId, predecessorId),
        eq(factVersions.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);

  if (!successor) {
    throw new FactsError("STATE_CONFLICT", "Correction replay successor missing");
  }

  const settlement = await settleForErrorCountFact(tx, { factVersionId: successor.id });

  const reversalRows = await tx.execute(sql`
    SELECT ple.id FROM point_ledger_entries ple
    INNER JOIN settlements s ON s.id = ple.settlement_id
    WHERE s.fact_version_id = ${predecessorId}::uuid
      AND ple.reverses_entry_id IS NOT NULL
  `);

  return {
    predecessorFactId: predecessorId,
    successorFactId: successor.id,
    reversalLedgerEntryIds: (reversalRows as unknown as { id: string }[]).map((r) => r.id),
    settlementId: settlement.settlementId,
    ledgerEntryId: settlement.ledgerEntryId,
    idempotentReplay: true,
  };
}

export async function correctFact(
  db: Database,
  input: CorrectFactInput,
): Promise<CorrectFactResult> {
  const now = input.now ?? new Date();

  if (!Number.isInteger(input.body.errorCount) || input.body.errorCount < 0) {
    throw new FactsError("VALIDATION_ERROR", "errorCount must be a non-negative integer");
  }

  if (!input.body.reason || input.body.reason.trim().length === 0) {
    throw new FactsError("VALIDATION_ERROR", "reason is required");
  }

  const payloadHash = hashIdempotencyPayload(input.body);

  if (input.adminOverride && !ADMIN_OVERRIDE_REASONS.has(input.adminOverride.reason)) {
    throw new FactsError("VALIDATION_ERROR", "Invalid admin override reason");
  }

  try {
    return await db.transaction(async (tx) => {
      const predecessor = await lockFactChain(tx, input.factId);

      if (predecessor.factKey !== "schedule.error_count" || predecessor.sourceKind !== "manual") {
        throw new FactsError("VALIDATION_ERROR", "Only manual error_count facts can be corrected");
      }

      if (!predecessor.confirmedAt || !predecessor.confirmedBy) {
        throw new FactsError("NOT_CONFIRMED", "Fact must be confirmed before correction");
      }

      if (!predecessor.scheduleItemId) {
        throw new FactsError("STATE_CONFLICT", "Fact is not bound to a schedule item");
      }

      const [existingSuccessor] = await tx
        .select({
          id: factVersions.id,
          idempotencyPayloadHash: factVersions.idempotencyPayloadHash,
        })
        .from(factVersions)
        .where(
          and(
            eq(factVersions.supersedesFactVersionId, predecessor.id),
            eq(factVersions.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);

      if (existingSuccessor) {
        if (existingSuccessor.idempotencyPayloadHash !== payloadHash) {
          throw new FactsError("IDEMPOTENCY_CONFLICT", "Correct fact idempotency payload mismatch");
        }
        return loadCorrectReplay(tx, predecessor.id, input.idempotencyKey);
      }

      const [anySuccessor] = await tx
        .select({ id: factVersions.id })
        .from(factVersions)
        .where(eq(factVersions.supersedesFactVersionId, predecessor.id))
        .limit(1);

      if (anySuccessor) {
        throw new FactsError("STATE_CONFLICT", "Fact already has a successor");
      }

      const item = await assertFormalScheduleItem(tx, predecessor.scheduleItemId);

      if (input.adminOverride) {
        // Admin path — no relationship check; route must use requireAdminSession
      } else {
        try {
          await requireActiveRelationship(tx, input.actorId, predecessor.studentId);
        } catch (error) {
          if (error instanceof FamilyAccessError && error.code === "FORBIDDEN") {
            throw new FactsError("FORBIDDEN", error.message);
          }
          throw error;
        }

        if (!isWithinCorrectionWindow(item.familyDate, now)) {
          if (isPastCorrectionWindow(item.familyDate, now)) {
            throw new FactsError("WINDOW_EXPIRED", "Correction window has expired");
          }
          throw new FactsError("WINDOW_EXPIRED", "Correction window is not yet open");
        }
      }

      const [successor] = await tx
        .insert(factVersions)
        .values({
          scheduleItemId: predecessor.scheduleItemId,
          studentId: predecessor.studentId,
          factKey: "schedule.error_count",
          sourceKind: "manual",
          value: { error_count: input.body.errorCount },
          idempotencyKey: input.idempotencyKey,
          idempotencyPayloadHash: payloadHash,
          completionKind: "not_applicable",
          occurredAt: predecessor.occurredAt,
          assertedAt: now,
          recordedAt: now,
          submittedBy: predecessor.submittedBy,
          confirmedAt: now,
          confirmedBy: input.actorId,
          supersedesFactVersionId: predecessor.id,
          correctionReason: input.body.reason,
        })
        .returning();

      if (!successor) {
        throw new Error("Failed to create correction successor fact");
      }

      const reversalLedgerEntryIds = await reverseLedgerEntriesForFact(tx, {
        factVersionId: predecessor.id,
        studentId: predecessor.studentId,
        actorId: input.actorId,
        idempotencyKey: input.idempotencyKey,
      });

      const settlement = await settleForErrorCountFact(tx, { factVersionId: successor.id });

      await appendAuditEvent(tx, {
        actorId: input.actorId,
        action: input.adminOverride ? "fact.corrected.admin" : "fact.corrected",
        resourceType: "fact_version",
        resourceId: successor.id,
        requestId: input.requestId ?? null,
        idempotencyKey: `audit:fact-corrected:${input.idempotencyKey}`,
        metadata: {
          predecessorFactId: predecessor.id,
          adminOverride: input.adminOverride?.reason ?? null,
          reason: input.body.reason,
        },
      });

      await appendOutboxEvent(tx, {
        aggregateType: "fact",
        aggregateId: successor.id,
        eventType: "fact.corrected",
        dedupeKey: `fact.corrected:${successor.id}:${input.idempotencyKey}`,
        payload: {
          predecessorFactId: predecessor.id,
          successorFactId: successor.id,
          studentId: predecessor.studentId,
          settlementId: settlement.settlementId,
          ledgerEntryId: settlement.ledgerEntryId,
        },
      });

      return {
        predecessorFactId: predecessor.id,
        successorFactId: successor.id,
        reversalLedgerEntryIds,
        settlementId: settlement.settlementId,
        ledgerEntryId: settlement.ledgerEntryId,
        idempotentReplay: false,
      };
    });
  } catch (error) {
    if (error instanceof SettlementError) {
      if (error.code === "NOT_FOUND") {
        throw new FactsError("NOT_FOUND", error.message);
      }
      if (error.code === "VALIDATION_ERROR") {
        throw new FactsError("VALIDATION_ERROR", error.message);
      }
      throw new FactsError("STATE_CONFLICT", error.message);
    }

    if (isPostgresUniqueViolation(error)) {
      return db.transaction(async (tx) => {
        const [raced] = await tx
          .select()
          .from(factVersions)
          .where(
            and(
              eq(factVersions.supersedesFactVersionId, input.factId),
              eq(factVersions.idempotencyKey, input.idempotencyKey),
            ),
          )
          .limit(1);

        if (!raced) {
          throw error;
        }

        if (raced.idempotencyPayloadHash !== payloadHash) {
          throw new FactsError("IDEMPOTENCY_CONFLICT", "Correct fact idempotency payload mismatch");
        }

        return loadCorrectReplay(tx, input.factId, input.idempotencyKey);
      });
    }

    throw error;
  }
}
