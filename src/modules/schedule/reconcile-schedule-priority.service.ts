import { and, eq, inArray } from "drizzle-orm";

import type { Database } from "@/db";
import { scheduleItems } from "@/db/schema";

/**
 * Keeps lower-priority pending items as facts while making the highest-priority
 * item at an identical instant the executable one. Equal priorities coexist:
 * the product only authorizes a higher priority to cover a lower one.
 */
export async function reconcileSchedulePriority(
  tx: Database,
  input: { studentId: string; scheduledAts: Date[] },
): Promise<void> {
  const uniqueTimes = [...new Map(input.scheduledAts.map((value) => [value.toISOString(), value])).values()];
  if (!uniqueTimes.length) return;
  const items = await tx.select().from(scheduleItems).where(and(
    eq(scheduleItems.studentId, input.studentId),
    eq(scheduleItems.status, "pending"),
    inArray(scheduleItems.scheduledAt, uniqueTimes),
  ));
  for (const at of uniqueTimes) {
    const atItems = items.filter((item) => item.scheduledAt.getTime() === at.getTime());
    const priority = Math.max(...atItems.map((item) => item.priority));
    const winner = atItems.find((item) => item.priority === priority);
    if (!winner) continue;
    await tx.update(scheduleItems).set({ suppressedByScheduleItemId: null }).where(and(
      eq(scheduleItems.studentId, input.studentId),
      eq(scheduleItems.status, "pending"),
      eq(scheduleItems.scheduledAt, at),
      eq(scheduleItems.priority, priority),
    ));
    if (atItems.some((item) => item.priority < priority)) {
      await tx.update(scheduleItems).set({ suppressedByScheduleItemId: winner.id }).where(and(
        eq(scheduleItems.studentId, input.studentId),
        eq(scheduleItems.status, "pending"),
        eq(scheduleItems.scheduledAt, at),
      ));
      await tx.update(scheduleItems).set({ suppressedByScheduleItemId: null }).where(eq(scheduleItems.id, winner.id));
    }
  }
}
