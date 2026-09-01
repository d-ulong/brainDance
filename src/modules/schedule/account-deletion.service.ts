import { and, eq } from "drizzle-orm";

import type { Database } from "@/db";
import { scheduleItems } from "@/db/schema";

export async function cancelPendingScheduleItemsForStudent(
  tx: Database,
  studentId: string,
): Promise<number> {
  const result = await tx
    .update(scheduleItems)
    .set({ status: "cancelled" })
    .where(and(eq(scheduleItems.studentId, studentId), eq(scheduleItems.status, "pending")))
    .returning({ id: scheduleItems.id });

  return result.length;
}
