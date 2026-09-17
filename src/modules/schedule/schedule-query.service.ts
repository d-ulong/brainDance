import { and, eq, gte, lte, ne } from "drizzle-orm";

import type { Database } from "@/db";
import {
  factVersions,
  planItemRules,
  planScheduleSlots,
  plans,
  pointLedgerEntries,
  scheduleItems,
  settlements,
} from "@/db/schema";
import { effectiveStatus } from "@/modules/schedule/effective-status";
import { assertStudentAccountNotFrozen } from "@/modules/data-lifecycle/freeze-guard.service";

function maximumPointsFromEntry(entry: Record<string, unknown>) {
  const points = entry.points;
  if (!points || typeof points !== "object") return 0;
  const values = Object.values(points as Record<string, unknown>).filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  );
  return Math.max(0, ...values);
}

export type CurrentFormalPlanDto = {
  planId: string;
  versionId: string;
  title: string;
  description: string | null;
  startDate: string;
  endDate: string | null;
  status: string;
  localTime: string | null;
};

/**
 * Read-only current formal plan query. Never updates rows or calls maintain.
 */
export async function queryCurrentFormalPlan(
  db: Database,
  studentId: string,
): Promise<CurrentFormalPlanDto | null> {
  await assertStudentAccountNotFrozen(db, studentId, "read");

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

export type ScheduleItemDto = {
  id: string;
  planId: string;
  planVersionId: string;
  studentId: string;
  ownerId: string;
  familyDate: string;
  slotKey: string;
  scheduledAt: Date;
  status: string;
  source: string;
  occurrenceKey: string;
  effectiveStatus: string;
  title: string;
  planTitle: string;
  priority: number;
  startedAt: Date | null;
  description: string | null;
  pointsEarned: number | null;
  pointsRuleLabel: string | null;
  maximumPoints: number;
  durationMinutes: number | null;
};

const POINTS_RULE_LABELS: Record<string, string> = {
  onTimeWithin: "按时且时长内",
  onTimeOver: "按时但超时",
  lateWithin: "迟开始且时长内",
  lateOver: "迟开始且超时",
  incomplete: "未完成",
};

function labelForPointsExplanation(explanation: string | null | undefined): string | null {
  if (!explanation) return null;
  const matched = explanation.match(/Plan item ([a-zA-Z]+):/);
  if (!matched?.[1]) return explanation;
  return POINTS_RULE_LABELS[matched[1]] ?? explanation;
}

export type QueryScheduleItemsInput = {
  studentId: string;
  from: string;
  to: string;
  now?: Date;
};

/**
 * Read-only schedule query. Never updates rows or calls persist/maintain.
 * Cancelled items are omitted so regenerated pending work is not shown beside stale cancels.
 */
export async function queryScheduleItems(
  db: Database,
  input: QueryScheduleItemsInput,
): Promise<ScheduleItemDto[]> {
  await assertStudentAccountNotFrozen(db, input.studentId, "read");

  const now = input.now ?? new Date();

  const rows = await db
    .select({
      item: scheduleItems,
      planTitle: plans.title,
      startedAt: planItemRules.startedAt,
      pointsEarned: pointLedgerEntries.amount,
      pointsExplanation: pointLedgerEntries.explanation,
    })
    .from(scheduleItems)
    .innerJoin(plans, eq(plans.id, scheduleItems.planId))
    .leftJoin(planItemRules, eq(planItemRules.scheduleItemId, scheduleItems.id))
    .leftJoin(
      factVersions,
      and(
        eq(factVersions.scheduleItemId, scheduleItems.id),
        eq(factVersions.factKey, "schedule.completed"),
      ),
    )
    .leftJoin(settlements, eq(settlements.factVersionId, factVersions.id))
    .leftJoin(pointLedgerEntries, eq(pointLedgerEntries.settlementId, settlements.id))
    .where(
      and(
        eq(scheduleItems.studentId, input.studentId),
        gte(scheduleItems.familyDate, input.from),
        lte(scheduleItems.familyDate, input.to),
        ne(scheduleItems.status, "cancelled"),
      ),
    );

  return rows.map(({ item, planTitle, startedAt, pointsEarned, pointsExplanation }) => {
    const entry = item.planSnapshot?.entry;
    const title =
      typeof entry === "object" &&
      entry !== null &&
      "title" in entry &&
      typeof entry.title === "string"
        ? entry.title
        : planTitle;
    const description =
      typeof entry === "object" &&
      entry !== null &&
      "description" in entry &&
      typeof (entry as { description?: unknown }).description === "string"
        ? (entry as { description: string }).description
        : null;
    const maximumPoints =
      typeof entry === "object" && entry !== null
        ? maximumPointsFromEntry(entry as Record<string, unknown>)
        : 0;
    const durationMinutes =
      typeof entry === "object" &&
      entry !== null &&
      "durationMinutes" in entry &&
      typeof (entry as { durationMinutes?: unknown }).durationMinutes === "number"
        ? (entry as { durationMinutes: number }).durationMinutes
        : null;
    return {
      id: item.id,
      planId: item.planId,
      planVersionId: item.planVersionId,
      studentId: item.studentId,
      ownerId: item.ownerId,
      familyDate: item.familyDate,
      slotKey: item.slotKey,
      scheduledAt: item.scheduledAt,
      status: item.status,
      source: item.source,
      occurrenceKey: item.occurrenceKey,
      effectiveStatus: effectiveStatus(
        { status: item.status, familyDate: item.familyDate, startedAt },
        now,
      ),
      title,
      planTitle,
      priority: item.priority,
      startedAt,
      description,
      pointsEarned: pointsEarned ?? null,
      pointsRuleLabel: labelForPointsExplanation(pointsExplanation),
      maximumPoints,
      durationMinutes,
    };
  });
}
