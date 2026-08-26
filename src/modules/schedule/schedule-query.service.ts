import { and, eq, gte, lte } from "drizzle-orm";

import type { Database } from "@/db";
import { scheduleItems } from "@/db/schema";
import { effectiveStatus } from "@/modules/schedule/effective-status";

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
