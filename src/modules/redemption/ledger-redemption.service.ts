import { sql } from "drizzle-orm";

import type { Database } from "@/db";
import { pointLedgerEntries } from "@/db/schema";
import { appendAuditEvent } from "@/modules/audit/append-audit-event";
import { appendOutboxEvent } from "@/modules/outbox/append-outbox-event";
import { RedemptionError } from "@/modules/redemption/errors";
import { upsertBalanceFromLedgerEntry } from "@/modules/settlement/ledger.service";

export type AppendRedemptionLedgerInput = {
  studentId: string;
  redemptionId: string;
  amount: number;
  actorId: string;
  idempotencyKey: string;
  now?: Date;
};

export type AppendRedemptionLedgerResult = {
  ledgerEntryId: string;
  created: boolean;
};

export async function appendLedgerForRedemption(
  tx: Database,
  input: AppendRedemptionLedgerInput,
): Promise<AppendRedemptionLedgerResult> {
  if (input.amount >= 0) {
    throw new RedemptionError("STATE_CONFLICT", "Redemption ledger amount must be negative");
  }

  const now = input.now ?? new Date();
  const explanation = `-${Math.abs(input.amount)} points for redemption ${input.redemptionId}`;

  const [existing] = await tx
    .select({ id: pointLedgerEntries.id })
    .from(pointLedgerEntries)
    .where(
      sql`${pointLedgerEntries.sourceType} = 'redemption' AND ${pointLedgerEntries.sourceId} = ${input.redemptionId}::uuid`,
    )
    .limit(1);

  if (existing) {
    return { ledgerEntryId: existing.id, created: false };
  }

  const [inserted] = await tx
    .insert(pointLedgerEntries)
    .values({
      studentId: input.studentId,
      settlementId: null,
      amount: input.amount,
      reason: "redemption.approved",
      sourceType: "redemption",
      sourceId: input.redemptionId,
      explanation,
      reversesEntryId: null,
      createdBy: input.actorId,
      idempotencyKey: input.idempotencyKey,
      createdAt: now,
    })
    .returning({ id: pointLedgerEntries.id });

  if (!inserted) {
    throw new RedemptionError("STATE_CONFLICT", "Failed to create redemption ledger entry");
  }

  await upsertBalanceFromLedgerEntry(tx, {
    studentId: input.studentId,
    ledgerEntryId: inserted.id,
    amount: input.amount,
    createdAt: now,
    now,
  });

  await appendAuditEvent(tx, {
    actorId: input.actorId,
    action: "point_ledger.created",
    resourceType: "point_ledger_entry",
    resourceId: inserted.id,
    idempotencyKey: `audit:point-ledger-created:${inserted.id}`,
    metadata: {
      redemptionId: input.redemptionId,
      amount: input.amount,
      sourceType: "redemption",
    },
  });

  await appendOutboxEvent(tx, {
    aggregateType: "point_redemption",
    aggregateId: input.redemptionId,
    eventType: "point_redemption.approved",
    dedupeKey: `point_redemption.approved:${input.redemptionId}`,
    payload: {
      schemaVersion: 1,
      redemptionId: input.redemptionId,
      ledgerEntryId: inserted.id,
      studentId: input.studentId,
      amount: input.amount,
    },
  });

  return { ledgerEntryId: inserted.id, created: true };
}
