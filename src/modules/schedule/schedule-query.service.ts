import { and, eq, gte, lte } from "drizzle-orm";

import type { Database } from "@/db";
import { planScheduleSlots, plans, scheduleItems } from "@/db/schema";
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
    .select()
    .from(scheduleItems)
    .where(
      and(
        eq(scheduleItems.studentId, input.studentId),
        gte(scheduleItems.familyDate, input.from),
        lte(scheduleItems.familyDate, input.to),
      ),
    );

  return rows.map((row) => ({
    id: row.id,
    planId: row.planId,
    planVersionId: row.planVersionId,
    studentId: row.studentId,
    ownerId: row.ownerId,
    familyDate: row.familyDate,
    slotKey: row.slotKey,
    scheduledAt: row.scheduledAt,
    status: row.status,
    source: row.source,
    occurrenceKey: row.occurrenceKey,
    effectiveStatus: effectiveStatus({ status: row.status, familyDate: row.familyDate }, now),
  }));
}
