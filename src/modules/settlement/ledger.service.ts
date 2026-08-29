import { desc, eq, sql } from "drizzle-orm";

import type { Database } from "@/db";
import { pointBalanceProjection, pointLedgerEntries } from "@/db/schema";
import { appendAuditEvent } from "@/modules/audit/append-audit-event";
import { appendOutboxEvent } from "@/modules/outbox/append-outbox-event";
import { isLedgerEntryAfter } from "@/modules/settlement/ledger-order";
import { SettlementError } from "@/modules/settlement/errors";

export type PointsBalanceDto = {
  balance: number;
  lastLedgerEntryId: string | null;
  updatedAt: Date | null;
};

export type PointsLedgerEntryDto = {
  id: string;
  settlementId: string;
  amount: number;
  reason: string;
  sourceType: string;
  sourceId: string;
  explanation: string;
};

/**
 * Read-only balance projection query.
 */
export async function queryPointsBalance(
  db: Database,
  studentId: string,
): Promise<PointsBalanceDto> {
  const [row] = await db
    .select({
      balance: pointBalanceProjection.balance,
      lastLedgerEntryId: pointBalanceProjection.lastLedgerEntryId,
      updatedAt: pointBalanceProjection.updatedAt,
    })
    .from(pointBalanceProjection)
    .where(eq(pointBalanceProjection.studentId, studentId))
    .limit(1);

  return {
    balance: row?.balance ?? 0,
    lastLedgerEntryId: row?.lastLedgerEntryId ?? null,
    updatedAt: row?.updatedAt ?? null,
  };
}

/**
 * Read-only ledger query.
 */
export async function queryPointsLedger(
  db: Database,
  studentId: string,
  limit: number,
): Promise<PointsLedgerEntryDto[]> {
  const rows = await db
    .select({
      id: pointLedgerEntries.id,
      settlementId: pointLedgerEntries.settlementId,
      amount: pointLedgerEntries.amount,
      reason: pointLedgerEntries.reason,
      sourceType: pointLedgerEntries.sourceType,
      sourceId: pointLedgerEntries.sourceId,
      explanation: pointLedgerEntries.explanation,
    })
    .from(pointLedgerEntries)
    .where(eq(pointLedgerEntries.studentId, studentId))
    .orderBy(desc(pointLedgerEntries.createdAt), desc(pointLedgerEntries.id))
    .limit(limit);

  return rows;
}

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

  const now = input.now ?? new Date();

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
      createdAt: now,
    })
    .onConflictDoNothing({ target: pointLedgerEntries.settlementId })
    .returning({ id: pointLedgerEntries.id });

  if (inserted) {
    await upsertBalanceFromLedgerEntry(tx, {
      studentId: input.studentId,
      ledgerEntryId: inserted.id,
      amount: input.amount,
      createdAt: now,
      now,
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

export async function upsertBalanceFromLedgerEntry(
  tx: Database,
  input: {
    studentId: string;
    ledgerEntryId: string;
    amount: number;
    createdAt: Date;
    now?: Date;
  },
): Promise<void> {
  const now = input.now ?? new Date();

  const [currentProjection] = await tx
    .select({
      lastLedgerEntryId: pointBalanceProjection.lastLedgerEntryId,
    })
    .from(pointBalanceProjection)
    .where(eq(pointBalanceProjection.studentId, input.studentId))
    .limit(1);

  let currentLast: { createdAt: Date; id: string } | null = null;
  if (currentProjection?.lastLedgerEntryId) {
    const [currentEntry] = await tx
      .select({
        id: pointLedgerEntries.id,
        createdAt: pointLedgerEntries.createdAt,
      })
      .from(pointLedgerEntries)
      .where(eq(pointLedgerEntries.id, currentProjection.lastLedgerEntryId))
      .limit(1);
    currentLast = currentEntry ?? null;
  }

  const shouldAdvanceLast = isLedgerEntryAfter(
    { createdAt: input.createdAt, id: input.ledgerEntryId },
    currentLast,
  );

  await tx
    .insert(pointBalanceProjection)
    .values({
      studentId: input.studentId,
      balance: input.amount,
      lastLedgerEntryId: shouldAdvanceLast ? input.ledgerEntryId : (currentLast?.id ?? null),
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: pointBalanceProjection.studentId,
      set: {
        balance: sql`${pointBalanceProjection.balance} + ${input.amount}`,
        lastLedgerEntryId: shouldAdvanceLast
          ? input.ledgerEntryId
          : pointBalanceProjection.lastLedgerEntryId,
        updatedAt: now,
      },
    });
}

export type AppendErrorCountLedgerInput = {
  studentId: string;
  settlementId: string;
  amount: number;
  errorCount: number;
  idempotencyKey: string;
  now?: Date;
};

export async function appendLedgerForErrorCountSettlement(
  tx: Database,
  input: AppendErrorCountLedgerInput,
): Promise<AppendLedgerResult> {
  const now = input.now ?? new Date();
  const explanation = `+${input.amount} points for error_count=${input.errorCount}`;

  const [inserted] = await tx
    .insert(pointLedgerEntries)
    .values({
      studentId: input.studentId,
      settlementId: input.settlementId,
      amount: input.amount,
      reason: "schedule.error_count",
      sourceType: "settlement",
      sourceId: input.settlementId,
      explanation,
      reversesEntryId: null,
      createdBy: null,
      idempotencyKey: input.idempotencyKey,
      createdAt: now,
    })
    .onConflictDoNothing({ target: pointLedgerEntries.settlementId })
    .returning({ id: pointLedgerEntries.id });

  if (inserted) {
    await upsertBalanceFromLedgerEntry(tx, {
      studentId: input.studentId,
      ledgerEntryId: inserted.id,
      amount: input.amount,
      createdAt: now,
      now,
    });

    await appendAuditEvent(tx, {
      action: "point_ledger.created",
      resourceType: "point_ledger_entry",
      resourceId: inserted.id,
      idempotencyKey: `audit:point-ledger-created:${inserted.id}`,
      metadata: {
        settlementId: input.settlementId,
        amount: input.amount,
        errorCount: input.errorCount,
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

export type AppendReversalLedgerInput = {
  studentId: string;
  settlementId: string;
  originalEntryId: string;
  amount: number;
  actorId: string;
  idempotencyKey: string;
  now?: Date;
};

export async function appendReversalLedgerEntry(
  tx: Database,
  input: AppendReversalLedgerInput,
): Promise<AppendLedgerResult> {
  const [existingReversal] = await tx
    .select({ id: pointLedgerEntries.id })
    .from(pointLedgerEntries)
    .where(eq(pointLedgerEntries.reversesEntryId, input.originalEntryId))
    .limit(1);

  if (existingReversal) {
    return { ledgerEntryId: existingReversal.id, created: false };
  }

  const now = input.now ?? new Date();

  const [inserted] = await tx
    .insert(pointLedgerEntries)
    .values({
      studentId: input.studentId,
      settlementId: input.settlementId,
      amount: input.amount,
      reason: "correction.reversal",
      sourceType: "reversal",
      sourceId: input.settlementId,
      explanation: `Reversal of ledger entry ${input.originalEntryId}`,
      reversesEntryId: input.originalEntryId,
      createdBy: input.actorId,
      idempotencyKey: input.idempotencyKey,
      createdAt: now,
    })
    .returning({ id: pointLedgerEntries.id });

  if (!inserted) {
    throw new SettlementError("STATE_CONFLICT", "Failed to create reversal ledger entry");
  }

  await upsertBalanceFromLedgerEntry(tx, {
    studentId: input.studentId,
    ledgerEntryId: inserted.id,
    amount: input.amount,
    createdAt: now,
    now,
  });

  return { ledgerEntryId: inserted.id, created: true };
}
