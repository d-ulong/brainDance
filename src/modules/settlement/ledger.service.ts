import { eq, sql } from "drizzle-orm";

import type { Database } from "@/db";
import { pointBalanceProjection, pointLedgerEntries } from "@/db/schema";
import { appendAuditEvent } from "@/modules/audit/append-audit-event";
import { appendOutboxEvent } from "@/modules/outbox/append-outbox-event";
import { SettlementError } from "@/modules/settlement/errors";

export type AppendLedgerInput = {
  studentId: string;
  settlementId: string;
  amount: number;
  completionKind: "on_time" | "late";
  idempotencyKey: string;
  now?: Date;
};

export type AppendLedgerResult = {
  ledgerEntryId: string;
  created: boolean;
};

export type AppendLedgerTestHooks = {
  beforeLedgerInsert?: () => Promise<void>;
};

function buildLedgerExplanation(completionKind: "on_time" | "late"): string {
  return `+10 points for schedule completion, completion_kind=${completionKind}`;
}

export async function loadExistingLedgerForSettlement(
  tx: Database,
  settlementId: string,
): Promise<{ id: string }> {
  const [existing] = await tx
    .select({ id: pointLedgerEntries.id })
    .from(pointLedgerEntries)
    .where(eq(pointLedgerEntries.settlementId, settlementId))
    .limit(1);

  if (!existing) {
    throw new SettlementError("STATE_CONFLICT", "Settlement ledger missing");
  }

  return existing;
}

export async function appendLedgerForSettlement(
  tx: Database,
  input: AppendLedgerInput,
  options?: { testHooks?: AppendLedgerTestHooks },
): Promise<AppendLedgerResult> {
  const explanation = buildLedgerExplanation(input.completionKind);

  if (options?.testHooks?.beforeLedgerInsert) {
    await options.testHooks.beforeLedgerInsert();
  }

  const [inserted] = await tx
    .insert(pointLedgerEntries)
    .values({
      studentId: input.studentId,
      settlementId: input.settlementId,
      amount: input.amount,
      reason: "schedule_complete",
      sourceType: "settlement",
      sourceId: input.settlementId,
      explanation,
      reversesEntryId: null,
      createdBy: null,
      idempotencyKey: input.idempotencyKey,
    })
    .onConflictDoNothing({ target: pointLedgerEntries.settlementId })
    .returning({ id: pointLedgerEntries.id });

  if (inserted) {
    const now = input.now ?? new Date();

    await tx
      .insert(pointBalanceProjection)
      .values({
        studentId: input.studentId,
        balance: input.amount,
        lastLedgerEntryId: inserted.id,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: pointBalanceProjection.studentId,
        set: {
          balance: sql`${pointBalanceProjection.balance} + excluded.balance`,
          lastLedgerEntryId: inserted.id,
          updatedAt: now,
        },
      });

    await appendAuditEvent(tx, {
      action: "point_ledger.created",
      resourceType: "point_ledger_entry",
      resourceId: inserted.id,
      idempotencyKey: `audit:point-ledger-created:${inserted.id}`,
      metadata: {
        settlementId: input.settlementId,
        amount: input.amount,
        completionKind: input.completionKind,
      },
    });

    await appendOutboxEvent(tx, {
      aggregateType: "settlement",
      aggregateId: input.settlementId,
      eventType: "points.settled",
      dedupeKey: `points.settled:${input.settlementId}`,
      payload: {
        settlementId: input.settlementId,
        ledgerEntryId: inserted.id,
        studentId: input.studentId,
        amount: input.amount,
      },
    });

    return { ledgerEntryId: inserted.id, created: true };
  }

  const existing = await loadExistingLedgerForSettlement(tx, input.settlementId);

  return { ledgerEntryId: existing.id, created: false };
}
