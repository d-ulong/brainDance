import { and, eq } from "drizzle-orm";

import type { Database } from "@/db";
import { pointLedgerEntries, settlements } from "@/db/schema";
import type { SettleForFactInput } from "@/modules/schedule/complete-schedule.service";
import { appendLedgerForSettlement } from "@/modules/settlement/ledger.service";
import {
  loadActivePointRuleForStudent,
  SCHEDULE_SYSTEM_COMPLETE_V1,
} from "@/modules/settlement/point-rule.service";
import { SettlementError } from "@/modules/settlement/errors";

export type SettleForFactResult = {
  settlementId: string;
  ledgerEntryId: string;
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
    throw new Error("Failed to load settlement after conflict");
  }

  return existing;
}

export async function settleForFact(
  tx: Database,
  input: SettleForFactInput,
): Promise<SettleForFactResult> {
  const activeRule = await loadActivePointRuleForStudent(tx, input.studentId);

  if (!activeRule) {
    throw new SettlementError("NO_ACTIVE_RULE", "No active point rule for student");
  }

  if (activeRule.templateId !== SCHEDULE_SYSTEM_COMPLETE_V1) {
    throw new SettlementError("VALIDATION_ERROR", "Unsupported active point rule template");
  }

  const amount = resolveRewardAmount(input.completionKind, activeRule.effect);
  const explanation = buildSettlementExplanation(input.completionKind);

  const [insertedSettlement] = await tx
    .insert(settlements)
    .values({
      studentId: input.studentId,
      factVersionId: input.factVersionId,
      ruleVersionId: activeRule.ruleVersionId,
      settlementPeriod: input.familyDate,
      result: "reward",
      explanation,
      idempotencyKey: input.idempotencyKey,
    })
    .onConflictDoNothing({
      target: [settlements.factVersionId, settlements.ruleVersionId, settlements.settlementPeriod],
    })
    .returning({ id: settlements.id });

  const settlement =
    insertedSettlement ??
    (await findExistingSettlement(tx, {
      factVersionId: input.factVersionId,
      ruleVersionId: activeRule.ruleVersionId,
      settlementPeriod: input.familyDate,
    }));

  const ledger = await appendLedgerForSettlement(tx, {
    studentId: input.studentId,
    settlementId: settlement.id,
    amount,
    completionKind: input.completionKind,
    idempotencyKey: input.idempotencyKey,
  });

  return {
    settlementId: settlement.id,
    ledgerEntryId: ledger.ledgerEntryId,
  };
}

export async function loadSettlementReplayForFact(
  tx: Database,
  factVersionId: string,
): Promise<SettleForFactResult | null> {
  const [settlement] = await tx
    .select({ id: settlements.id })
    .from(settlements)
    .where(eq(settlements.factVersionId, factVersionId))
    .limit(1);

  if (!settlement) {
    return null;
  }

  const [ledger] = await tx
    .select({ id: pointLedgerEntries.id })
    .from(pointLedgerEntries)
    .where(eq(pointLedgerEntries.settlementId, settlement.id))
    .limit(1);

  if (!ledger) {
    return null;
  }

  return {
    settlementId: settlement.id,
    ledgerEntryId: ledger.id,
  };
}
