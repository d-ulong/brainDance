import { and, eq } from "drizzle-orm";

import type { Database } from "@/db";
import { factVersions, scheduleItems, settlements } from "@/db/schema";
import type { SettleForFactInput } from "@/modules/schedule/complete-schedule.service";
import {
  appendLedgerForSettlement,
  loadExistingLedgerForSettlement,
} from "@/modules/settlement/ledger.service";
import {
  loadActivePointRuleForStudent,
  SCHEDULE_SYSTEM_COMPLETE_V1,
} from "@/modules/settlement/point-rule.service";
import { SettlementError } from "@/modules/settlement/errors";

export type SettleForFactResult = {
  settlementId: string;
  ledgerEntryId: string;
};

type FactSettlementContext = {
  factVersionId: string;
  studentId: string;
  completionKind: "on_time" | "late";
  familyDate: string;
  idempotencyKey: string;
};

function resolveRewardAmount(
  completionKind: "on_time" | "late",
  effect: { amount: number; rewardsLateCompletion?: boolean },
): number {
  if (completionKind === "on_time") {
    return effect.amount;
  }
  if (effect.rewardsLateCompletion) {
    return effect.amount;
  }
  return 0;
}

function buildSettlementExplanation(completionKind: "on_time" | "late"): string {
  return `Reward for schedule completion (${completionKind})`;
}

async function loadFactSettlementContext(
  tx: Database,
  factVersionId: string,
): Promise<FactSettlementContext> {
  const [fact] = await tx
    .select()
    .from(factVersions)
    .where(eq(factVersions.id, factVersionId))
    .limit(1);

  if (!fact) {
    throw new SettlementError("NOT_FOUND", "Fact version not found");
  }

  const [item] = await tx
    .select()
    .from(scheduleItems)
    .where(eq(scheduleItems.id, fact.scheduleItemId))
    .limit(1);

  if (!item) {
    throw new SettlementError("STATE_CONFLICT", "Schedule item missing for fact");
  }

  if (fact.studentId !== item.studentId) {
    throw new SettlementError("STATE_CONFLICT", "Fact and schedule item student mismatch");
  }

  if (fact.completionKind !== "on_time" && fact.completionKind !== "late") {
    throw new SettlementError("STATE_CONFLICT", "Fact completion kind is invalid");
  }

  return {
    factVersionId: fact.id,
    studentId: fact.studentId,
    completionKind: fact.completionKind,
    familyDate: item.familyDate,
    idempotencyKey: fact.idempotencyKey,
  };
}

async function findExistingSettlement(
  tx: Database,
  input: {
    factVersionId: string;
    ruleVersionId: string;
    settlementPeriod: string;
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
      ),
    )
    .limit(1);

  if (!existing) {
    throw new SettlementError("STATE_CONFLICT", "Settlement conflict without existing row");
  }

  return existing;
}

export async function settleForFact(
  tx: Database,
  input: SettleForFactInput,
): Promise<SettleForFactResult> {
  const ctx = await loadFactSettlementContext(tx, input.factVersionId);

  const activeRule = await loadActivePointRuleForStudent(tx, ctx.studentId);

  if (!activeRule) {
    throw new SettlementError("NO_ACTIVE_RULE", "No active point rule for student");
  }

  if (activeRule.templateId !== SCHEDULE_SYSTEM_COMPLETE_V1) {
    throw new SettlementError("VALIDATION_ERROR", "Unsupported active point rule template");
  }

  const amount = resolveRewardAmount(ctx.completionKind, activeRule.effect);
  const explanation = buildSettlementExplanation(ctx.completionKind);

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
      target: [settlements.factVersionId, settlements.ruleVersionId, settlements.settlementPeriod],
    })
    .returning({ id: settlements.id });

  if (insertedSettlement) {
    const ledger = await appendLedgerForSettlement(tx, {
      studentId: ctx.studentId,
      settlementId: insertedSettlement.id,
      amount,
      completionKind: ctx.completionKind,
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
  });

  const ledger = await loadExistingLedgerForSettlement(tx, settlement.id);

  return {
    settlementId: settlement.id,
    ledgerEntryId: ledger.id,
  };
}

export async function loadSettlementReplayForFact(
  tx: Database,
  factVersionId: string,
): Promise<SettleForFactResult> {
  const [settlement] = await tx
    .select({ id: settlements.id })
    .from(settlements)
    .where(eq(settlements.factVersionId, factVersionId))
    .limit(1);

  if (!settlement) {
    throw new SettlementError("STATE_CONFLICT", "Complete replay settlement missing");
  }

  const ledger = await loadExistingLedgerForSettlement(tx, settlement.id);

  return {
    settlementId: settlement.id,
    ledgerEntryId: ledger.id,
  };
}
