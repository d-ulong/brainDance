import { and, eq, gt, inArray } from "drizzle-orm";

import type { Database } from "@/db";
import { scheduleItems } from "@/db/schema";
import { isPastCompletionWindow } from "@/modules/time-policy/completion-window";

/**
 * Persists expired status for pending items past the completion window.
 * Must only be called inside write transactions.
 */
export async function persistExpiredPastWindow(
  db: Database,
  studentId: string,
  now: Date,
): Promise<number> {
  const pending = await db
    .select({
      id: scheduleItems.id,
      familyDate: scheduleItems.familyDate,
    })
    .from(scheduleItems)
    .where(and(eq(scheduleItems.studentId, studentId), eq(scheduleItems.status, "pending")));

  const expiredIds = pending
    .filter((item) => isPastCompletionWindow(item.familyDate, now))
    .map((item) => item.id);

  if (expiredIds.length === 0) {
    return 0;
  }

  await db
    .update(scheduleItems)
    .set({ status: "expired" })
    .where(inArray(scheduleItems.id, expiredIds));

  return expiredIds.length;
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
