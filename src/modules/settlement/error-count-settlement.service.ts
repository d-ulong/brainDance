import { and, eq, sql } from "drizzle-orm";

import type { Database } from "@/db";
import { factVersions, plans, pointLedgerEntries, scheduleItems, settlements } from "@/db/schema";
import { FactsError } from "@/modules/facts/errors";
import { SettlementError } from "@/modules/settlement/errors";
import {
  appendLedgerForErrorCountSettlement,
  appendReversalLedgerEntry,
} from "@/modules/settlement/ledger.service";
import {
  loadActivePointRuleForStudent,
  SCHEDULE_ERROR_COUNT_V1,
} from "@/modules/settlement/point-rule.service";

export type ErrorCountSettlementContext = {
  factVersionId: string;
  studentId: string;
  errorCount: number;
  familyDate: string;
  idempotencyKey: string;
};

async function loadErrorCountSettlementContext(
  tx: Database,
  factVersionId: string,
): Promise<ErrorCountSettlementContext> {
  const [fact] = await tx
    .select()
    .from(factVersions)
    .where(eq(factVersions.id, factVersionId))
    .limit(1);

  if (!fact) {
    throw new SettlementError("NOT_FOUND", "Fact version not found");
  }

  if (fact.factKey !== "schedule.error_count" || fact.sourceKind !== "manual") {
    throw new SettlementError("VALIDATION_ERROR", "Fact is not a manual error_count fact");
  }

  if (!fact.confirmedAt || !fact.confirmedBy) {
    throw new SettlementError("STATE_CONFLICT", "Fact must be confirmed before settlement");
  }

  if (!fact.scheduleItemId) {
    throw new SettlementError("STATE_CONFLICT", "Fact is not bound to a schedule item");
  }

  const errorCount = (fact.value as { error_count?: unknown }).error_count;
  if (typeof errorCount !== "number" || !Number.isInteger(errorCount) || errorCount < 0) {
    throw new SettlementError("VALIDATION_ERROR", "Invalid error_count value on fact");
  }

  const [item] = await tx
    .select()
    .from(scheduleItems)
    .where(eq(scheduleItems.id, fact.scheduleItemId))
    .limit(1);

  if (!item) {
    throw new SettlementError("STATE_CONFLICT", "Schedule item missing for fact");
  }

  return {
    factVersionId: fact.id,
    studentId: fact.studentId,
    errorCount,
    familyDate: item.familyDate,
    idempotencyKey: fact.idempotencyKey,
  };
}

function resolveErrorCountRewardAmount(
  errorCount: number,
  parameters: { maximumErrorCount: number },
  effect: { amount: number },
): number {
  if (errorCount <= parameters.maximumErrorCount) {
    return effect.amount;
  }
  return 0;
}

async function findExistingSettlement(
  tx: Database,
  input: {
    factVersionId: string;
    ruleVersionId: string;
    settlementPeriod: string;
    result: "reward" | "reversal";
  },
): Promise<{ id: string }> {
  const [existing] = await tx
    .select({ id: settlements.id })
    .from(settlements)
    .where(
      and(
        eq(settlements.factVersionId, input.factVersionId),
        eq(settlements.ruleVersionId, input.ruleVersionId),
        eq(settlements.settlementPeriod, input.settlementPeriod),
        eq(settlements.result, input.result),
      ),
    )
    .limit(1);

  if (!existing) {
    throw new SettlementError("STATE_CONFLICT", "Settlement conflict without existing row");
  }

  return existing;
}

export type SettleErrorCountResult = {
  settlementId: string;
  ledgerEntryId: string;
};

export async function settleForErrorCountFact(
  tx: Database,
  input: { factVersionId: string },
): Promise<SettleErrorCountResult> {
  const ctx = await loadErrorCountSettlementContext(tx, input.factVersionId);

  const activeRule = await loadActivePointRuleForStudent(
    tx,
    ctx.studentId,
    SCHEDULE_ERROR_COUNT_V1,
  );

  if (!activeRule) {
    throw new SettlementError("NO_ACTIVE_RULE", "No active point rule for student");
  }

  if (activeRule.templateId !== SCHEDULE_ERROR_COUNT_V1) {
    throw new SettlementError("VALIDATION_ERROR", "Unsupported active point rule template");
  }

  const parameters = activeRule.parameters as { maximumErrorCount: number };
  const amount = resolveErrorCountRewardAmount(ctx.errorCount, parameters, activeRule.effect);
  const explanation = `Reward for error_count=${ctx.errorCount} (threshold=${parameters.maximumErrorCount})`;

  const [insertedSettlement] = await tx
    .insert(settlements)
    .values({
      studentId: ctx.studentId,
      factVersionId: ctx.factVersionId,
      ruleVersionId: activeRule.ruleVersionId,
      settlementPeriod: ctx.familyDate,
      result: "reward",
      explanation,
      idempotencyKey: ctx.idempotencyKey,
    })
    .onConflictDoNothing({
      target: [
        settlements.factVersionId,
        settlements.ruleVersionId,
        settlements.settlementPeriod,
        settlements.result,
      ],
    })
    .returning({ id: settlements.id });

  if (insertedSettlement) {
    const ledger = await appendLedgerForErrorCountSettlement(tx, {
      studentId: ctx.studentId,
      settlementId: insertedSettlement.id,
      amount,
      errorCount: ctx.errorCount,
      idempotencyKey: ctx.idempotencyKey,
    });

    return {
      settlementId: insertedSettlement.id,
      ledgerEntryId: ledger.ledgerEntryId,
    };
  }

  const settlement = await findExistingSettlement(tx, {
    factVersionId: ctx.factVersionId,
    ruleVersionId: activeRule.ruleVersionId,
    settlementPeriod: ctx.familyDate,
    result: "reward",
  });

  const [ledger] = await tx
    .select({ id: pointLedgerEntries.id })
    .from(pointLedgerEntries)
    .where(eq(pointLedgerEntries.settlementId, settlement.id))
    .limit(1);

  if (!ledger) {
    throw new SettlementError("STATE_CONFLICT", "Settlement ledger missing");
  }

  return {
    settlementId: settlement.id,
    ledgerEntryId: ledger.id,
  };
}

export async function loadLedgerEntriesForFact(
  tx: Database,
  factVersionId: string,
): Promise<Array<{ id: string; amount: number; settlementId: string | null }>> {
  const rows = await tx
    .select({
      id: pointLedgerEntries.id,
      amount: pointLedgerEntries.amount,
      settlementId: pointLedgerEntries.settlementId,
    })
    .from(pointLedgerEntries)
    .innerJoin(settlements, eq(settlements.id, pointLedgerEntries.settlementId))
    .where(eq(settlements.factVersionId, factVersionId));

  return rows;
}

export async function reverseLedgerEntriesForFact(
  tx: Database,
  input: {
    factVersionId: string;
    studentId: string;
    actorId: string;
    idempotencyKey: string;
  },
): Promise<string[]> {
  const entries = await loadLedgerEntriesForFact(tx, input.factVersionId);
  const reversalIds: string[] = [];

  for (const entry of entries) {
    if (entry.amount <= 0 || !entry.settlementId) {
      continue;
    }

    const reversalKey = `${input.idempotencyKey}:reversal:${entry.id}`;

    const [existingReversal] = await tx
      .select({ id: pointLedgerEntries.id })
      .from(pointLedgerEntries)
      .where(eq(pointLedgerEntries.reversesEntryId, entry.id))
      .limit(1);

    if (existingReversal) {
      reversalIds.push(existingReversal.id);
      continue;
    }

    const [originalSettlement] = await tx
      .select({
        ruleVersionId: settlements.ruleVersionId,
        settlementPeriod: settlements.settlementPeriod,
      })
      .from(settlements)
      .where(eq(settlements.id, entry.settlementId))
      .limit(1);

    if (!originalSettlement) {
      throw new SettlementError("STATE_CONFLICT", "Original settlement missing for reversal");
    }

    const [insertedSettlement] = await tx
      .insert(settlements)
      .values({
        studentId: input.studentId,
        factVersionId: input.factVersionId,
        ruleVersionId: originalSettlement.ruleVersionId,
        settlementPeriod: originalSettlement.settlementPeriod,
        result: "reversal",
        explanation: `Reversal settlement for ledger entry ${entry.id}`,
        idempotencyKey: reversalKey,
      })
      .onConflictDoNothing({
        target: [
          settlements.factVersionId,
          settlements.ruleVersionId,
          settlements.settlementPeriod,
          settlements.result,
        ],
      })
      .returning({ id: settlements.id });

    const settlementId =
      insertedSettlement?.id ??
      (
        await findExistingSettlement(tx, {
          factVersionId: input.factVersionId,
          ruleVersionId: originalSettlement.ruleVersionId,
          settlementPeriod: originalSettlement.settlementPeriod,
          result: "reversal",
        })
      ).id;

    const reversal = await appendReversalLedgerEntry(tx, {
      studentId: input.studentId,
      settlementId,
      originalEntryId: entry.id,
      amount: -entry.amount,
      actorId: input.actorId,
      idempotencyKey: reversalKey,
    });

    reversalIds.push(reversal.ledgerEntryId);
  }

  return reversalIds;
}

export async function assertFormalScheduleItem(
  tx: Database,
  scheduleItemId: string,
): Promise<typeof scheduleItems.$inferSelect> {
  await tx.execute(
    sql`SELECT id FROM schedule_items WHERE id = ${scheduleItemId}::uuid FOR UPDATE`,
  );

  const [item] = await tx
    .select()
    .from(scheduleItems)
    .where(eq(scheduleItems.id, scheduleItemId))
    .limit(1);

  if (!item) {
    throw new FactsError("NOT_FOUND", "Schedule item not found");
  }

  const [plan] = await tx
    .select({ planKind: plans.planKind })
    .from(plans)
    .where(eq(plans.id, item.planId))
    .limit(1);

  if (!plan || plan.planKind !== "formal") {
    throw new FactsError("VALIDATION_ERROR", "Schedule item is not from a formal plan");
  }

  return item;
}
