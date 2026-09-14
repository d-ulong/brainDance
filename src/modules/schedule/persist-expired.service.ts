import { and, eq, gt, inArray, isNull } from "drizzle-orm";

import type { Database } from "@/db";
import { factVersions, planItemRules, scheduleItems } from "@/db/schema";
import { isPastCompletionWindow } from "@/modules/time-policy/completion-window";
import { isPastPlanSettlementDeadline } from "@/modules/time-policy/plan-settlement-deadline";
import { settleForFact } from "@/modules/settlement/settlement.service";

/** Test-only seam; production callers must omit. */
export type PersistExpiredOptions = {
  testHooks?: {
    afterSelectCandidates?: (expiredIds: string[]) => void | Promise<void>;
  };
};

/**
 * Persists expired status for pending items past the completion window.
 * Must only be called inside write transactions.
 */
export async function persistExpiredPastWindow(
  db: Database,
  studentId: string,
  now: Date,
  options?: PersistExpiredOptions,
): Promise<number> {
  const pending = await db
    .select({
      id: scheduleItems.id,
      familyDate: scheduleItems.familyDate,
    })
    .from(scheduleItems)
    .where(and(eq(scheduleItems.studentId, studentId), eq(scheduleItems.status, "pending"), isNull(scheduleItems.suppressedByScheduleItemId)));

  const planRuleIds = new Set((await db.select({ scheduleItemId: planItemRules.scheduleItemId }).from(planItemRules).where(inArray(planItemRules.scheduleItemId, pending.map((item) => item.id)))).map((row) => row.scheduleItemId));
  const expiredIds = pending.filter((item) => planRuleIds.has(item.id) ? isPastPlanSettlementDeadline(item.familyDate, now) : isPastCompletionWindow(item.familyDate, now)).map((item) => item.id);

  if (expiredIds.length === 0) {
    return 0;
  }

  if (options?.testHooks?.afterSelectCandidates) {
    await options.testHooks.afterSelectCandidates(expiredIds);
  }

  const updated = await db
    .update(scheduleItems)
    .set({ status: "expired" })
    .where(
      and(
        eq(scheduleItems.studentId, studentId),
        eq(scheduleItems.status, "pending"),
        inArray(scheduleItems.id, expiredIds),
      ),
    )
    .returning({ id: scheduleItems.id, studentId: scheduleItems.studentId, familyDate: scheduleItems.familyDate });

  for (const item of updated) {
    if (!planRuleIds.has(item.id)) continue;
    const idempotencyKey = `plan-incomplete:${item.id}`;
    const [fact] = await db.insert(factVersions).values({ scheduleItemId: item.id, studentId: item.studentId, factKey: "schedule.incomplete", sourceKind: "system", value: { finalised_at: now.toISOString() }, idempotencyKey, idempotencyPayloadHash: idempotencyKey, completionKind: "not_applicable", occurredAt: now, assertedAt: now, recordedAt: now }).onConflictDoNothing({ target: [factVersions.scheduleItemId, factVersions.idempotencyKey] }).returning({ id: factVersions.id });
    if (fact) await settleForFact(db, { factVersionId: fact.id });
  }

  return updated.length;
}

/**
 * Cancels pending items with family_date strictly after end_date.
 */
export async function cancelPendingAfterEndDate(
  db: Database,
  studentId: string,
  endDate: string | null | undefined,
): Promise<number> {
  if (endDate == null) {
    return 0;
  }

  const rows = await db
    .update(scheduleItems)
    .set({ status: "cancelled" })
    .where(
      and(
        eq(scheduleItems.studentId, studentId),
        eq(scheduleItems.status, "pending"),
        gt(scheduleItems.familyDate, endDate),
      ),
    )
    .returning({ id: scheduleItems.id });

  return rows.length;
}
