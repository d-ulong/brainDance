import { and, eq } from "drizzle-orm";

import type { Database } from "@/db";
import { factVersions, planItemRules, scheduleItems, settlements } from "@/db/schema";
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
import { scorePlanEntry, type PlanEntry } from "@/modules/schedule/plan-definition";

export type SettleForFactResult = {
  settlementId: string;
  ledgerEntryId: string;
};

type FactSettlementContext = {
  factVersionId: string;
  scheduleItemId: string;
  studentId: string;
  completionKind: "on_time" | "late" | "not_applicable";
  familyDate: string;
  idempotencyKey: string;
  factKey: string;
  occurredAt: Date;
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

export type SettleForFactTestHooks = {
  beforeSettlementInsert?: () => Promise<void>;
};

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

  if (!fact.scheduleItemId) {
    throw new SettlementError("STATE_CONFLICT", "Fact is not bound to a schedule item");
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

  return {
    factVersionId: fact.id,
    scheduleItemId: fact.scheduleItemId,
    studentId: fact.studentId,
    completionKind: fact.completionKind as FactSettlementContext["completionKind"],
    familyDate: item.familyDate,
    idempotencyKey: fact.idempotencyKey,
    factKey: fact.factKey,
    occurredAt: fact.occurredAt,
  };
}

async function settlePlanEntryFact(tx: Database, ctx: FactSettlementContext): Promise<SettleForFactResult | null> {
  const [rule] = await tx.select().from(planItemRules).where(eq(planItemRules.scheduleItemId, ctx.scheduleItemId)).limit(1);
  if (!rule) return null;
  if (ctx.factKey !== "schedule.completed" && ctx.factKey !== "schedule.incomplete") throw new SettlementError("STATE_CONFLICT", "计划事实不可结算");
  const scored = scorePlanEntry(rule.entry as PlanEntry, { startedAt: rule.startedAt, completedAt: ctx.factKey === "schedule.completed" ? ctx.occurredAt : null, familyDate: ctx.familyDate });
  const explanation = `Plan item ${scored.condition}: ${scored.amount} points`;
  const [inserted] = await tx.insert(settlements).values({ studentId: ctx.studentId, factVersionId: ctx.factVersionId, ruleVersionId: rule.ruleVersionId, settlementPeriod: ctx.familyDate, result: "reward", explanation, idempotencyKey: ctx.idempotencyKey }).onConflictDoNothing({ target: [settlements.factVersionId, settlements.ruleVersionId, settlements.settlementPeriod, settlements.result] }).returning({ id: settlements.id });
  const settlement = inserted ?? await findExistingSettlement(tx, { factVersionId: ctx.factVersionId, ruleVersionId: rule.ruleVersionId, settlementPeriod: ctx.familyDate, result: "reward" });
  const ledger = await appendLedgerForSettlement(tx, { studentId: ctx.studentId, settlementId: settlement.id, amount: scored.amount, completionKind: ctx.factKey === "schedule.completed" && ctx.completionKind === "late" ? "late" : "on_time", idempotencyKey: ctx.idempotencyKey, reason: "plan_entry", explanation });
  return { settlementId: settlement.id, ledgerEntryId: ledger.ledgerEntryId };
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

export async function settleForFact(
  tx: Database,
  input: SettleForFactInput,
  options?: { testHooks?: SettleForFactTestHooks },
): Promise<SettleForFactResult> {
  const ctx = await loadFactSettlementContext(tx, input.factVersionId);

  const planSettlement = await settlePlanEntryFact(tx, ctx);
  if (planSettlement) return planSettlement;

  if (ctx.completionKind !== "on_time" && ctx.completionKind !== "late") {
    throw new SettlementError("STATE_CONFLICT", "Fact completion kind is invalid");
  }

  const activeRule = await loadActivePointRuleForStudent(
    tx,
    ctx.studentId,
    SCHEDULE_SYSTEM_COMPLETE_V1,
  );

  if (!activeRule) {
    throw new SettlementError("NO_ACTIVE_RULE", "No active point rule for student");
  }

  if (activeRule.templateId !== SCHEDULE_SYSTEM_COMPLETE_V1) {
    throw new SettlementError("VALIDATION_ERROR", "Unsupported active point rule template");
  }

  const amount = resolveRewardAmount(ctx.completionKind, activeRule.effect);
  const explanation = buildSettlementExplanation(ctx.completionKind);

  if (options?.testHooks?.beforeSettlementInsert) {
    await options.testHooks.beforeSettlementInsert();
  }

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
    result: "reward",
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
