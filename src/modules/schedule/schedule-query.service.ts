import { and, eq, gte, lte } from "drizzle-orm";

import type { Database } from "@/db";
import { planItemRules, planScheduleSlots, plans, scheduleItems } from "@/db/schema";
import { effectiveStatus } from "@/modules/schedule/effective-status";
import { assertStudentAccountNotFrozen } from "@/modules/data-lifecycle/freeze-guard.service";

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
};

export type QueryScheduleItemsInput = {
  studentId: string;
  from: string;
  to: string;
  now?: Date;
};

/**
 * Read-only schedule query. Never updates rows or calls persist/maintain.
 */
export async function queryScheduleItems(
  db: Database,
  input: QueryScheduleItemsInput,
): Promise<ScheduleItemDto[]> {
  await assertStudentAccountNotFrozen(db, input.studentId, "read");

  const now = input.now ?? new Date();

  const rows = await db
    .select({ item: scheduleItems, planTitle: plans.title, startedAt: planItemRules.startedAt })
    .from(scheduleItems)
    .innerJoin(plans, eq(plans.id, scheduleItems.planId))
    .leftJoin(planItemRules, eq(planItemRules.scheduleItemId, scheduleItems.id))
    .where(
      and(
        eq(scheduleItems.studentId, input.studentId),
        gte(scheduleItems.familyDate, input.from),
        lte(scheduleItems.familyDate, input.to),
      ),
    );

  return rows.map(({ item, planTitle, startedAt }) => {
    const entry = item.planSnapshot?.entry;
    const title = typeof entry === "object" && entry !== null && "title" in entry && typeof entry.title === "string" ? entry.title : planTitle;
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
      effectiveStatus: effectiveStatus({ status: item.status, familyDate: item.familyDate, startedAt }, now),
      title,
      planTitle,
      priority: item.priority,
      startedAt,
    };
  });
}
