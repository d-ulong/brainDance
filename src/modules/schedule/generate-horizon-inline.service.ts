import { and, eq } from "drizzle-orm";

import type { Database } from "@/db";
import { planScheduleSlots, scheduleItems } from "@/db/schema";
import { buildOccurrenceKey } from "@/modules/schedule/occurrence-key";
import { ScheduleError } from "@/modules/schedule/errors";
import { familyDateRange } from "@/modules/time-policy/family-date-range";
import { toScheduledAt } from "@/modules/time-policy/to-scheduled-at";

export type PlanSnapshot = {
  id: string;
  owner_id: string;
  student_id: string;
  plan_kind: string;
  status: string;
  title: string;
  description: string | null;
  start_date: string;
  end_date: string | null;
  current_version: string;
};

export type VersionRef = {
  id: string;
};

export type GenerateHorizonInlineInput = {
  plan: PlanSnapshot;
  version: VersionRef;
  from: string;
  through: string;
};

/**
 * Generates schedule items for [from, through] using the specified version slot snapshot.
 * Returns the number of rows actually inserted.
 */
export async function generateHorizonInline(
  db: Database,
  input: GenerateHorizonInlineInput,
): Promise<number> {
  const [slot] = await db
    .select({ localTime: planScheduleSlots.localTime })
    .from(planScheduleSlots)
    .where(
      and(
        eq(planScheduleSlots.planVersionId, input.version.id),
        eq(planScheduleSlots.slotKey, "default"),
      ),
    )
    .limit(1);

  if (!slot) {
    throw new ScheduleError(
      "SLOT_INVARIANT",
      `Default slot missing for plan version ${input.version.id}`,
    );
  }

  const localTime = slot.localTime;
  const dates = familyDateRange(input.from, input.through);
  if (dates.length === 0) {
    return 0;
  }

  const values = dates
    .filter((familyDate) => input.plan.end_date == null || familyDate <= input.plan.end_date)
    .map((familyDate) => ({
      planId: input.plan.id,
      planVersionId: input.version.id,
      studentId: input.plan.student_id,
      ownerId: input.plan.owner_id,
      familyDate,
      slotKey: "default" as const,
      scheduledAt: toScheduledAt(familyDate, localTime),
      status: "pending" as const,
      source: "plan" as const,
      occurrenceKey: buildOccurrenceKey({
        planId: input.plan.id,
        planVersionId: input.version.id,
        familyDate,
        localTime,
      }),
      planSnapshot: null,
    }));

  if (values.length === 0) {
    return 0;
  }

  const inserted = await db
    .insert(scheduleItems)
    .values(values)
    .onConflictDoNothing({ target: scheduleItems.occurrenceKey })
    .returning({ id: scheduleItems.id });

  return inserted.length;
}
