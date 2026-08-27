import { and, desc, eq } from "drizzle-orm";

import type { Database } from "@/db";
import { planScheduleSlots, plans, pointBalanceProjection, pointLedgerEntries } from "@/db/schema";

export async function queryCurrentFormalPlan(db: Database, studentId: string) {
  const [plan] = await db
    .select()
    .from(plans)
    .where(
      and(eq(plans.studentId, studentId), eq(plans.planKind, "formal"), eq(plans.status, "active")),
    )
    .limit(1);

  if (!plan || !plan.currentVersion) {
    return null;
  }

  const [slot] = await db
    .select({ localTime: planScheduleSlots.localTime })
    .from(planScheduleSlots)
    .where(
      and(
        eq(planScheduleSlots.planVersionId, plan.currentVersion),
        eq(planScheduleSlots.slotKey, "default"),
      ),
    )
    .limit(1);

  return {
    planId: plan.id,
    versionId: plan.currentVersion,
    title: plan.title,
    description: plan.description,
    startDate: plan.startDate,
    endDate: plan.endDate,
    status: plan.status,
    localTime: slot?.localTime ? slot.localTime.slice(0, 5) : null,
  };
}

export async function queryPointsBalance(db: Database, studentId: string) {
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

export async function queryPointsLedger(db: Database, studentId: string, limit: number) {
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
    .orderBy(desc(pointLedgerEntries.id))
    .limit(limit);

  return rows;
}
