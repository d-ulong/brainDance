import { and, eq, gte, sql } from "drizzle-orm";
import type { Database } from "@/db";
import { plans, scheduleItems, users } from "@/db/schema";
import { appendAuditEvent } from "@/modules/audit/append-audit-event";
import { appendOutboxEvent } from "@/modules/outbox/append-outbox-event";
import { assertSubjectAccess } from "@/modules/data-lifecycle/subject-access.service";
import { isStudentAccountFrozen } from "@/modules/data-lifecycle/freeze-guard.service";
import { lockLedgerSubject } from "@/modules/settlement/ledger.service";
import { persistExpiredPastWindow } from "@/modules/schedule/persist-expired.service";
import { ageInYearsAt } from "@/modules/time-policy/resolve-age-band";
import { toFamilyDate } from "@/modules/time-policy/to-family-date";

export const LIFECYCLE_DUE_EVENTS = [
  "lifecycle.schedule_due",
  "lifecycle.deletion_due",
  "lifecycle.age_due",
] as const;

/** Only durable work is scheduled here. Existing outbox leases, bounded retries
 * and dead/replay own execution; unavailable confirmation is never an error job. */
export async function enqueueDueLifecycleWork(
  db: Database,
  now = new Date(),
  batchSize = 20,
): Promise<number> {
  const limit = Math.min(100, Math.max(1, Math.trunc(batchSize)));
  const familyDate = toFamilyDate(now);
  let count = 0;
  const schedules = await db.execute(sql`
    SELECT s.id, s.student_id, u.authorization_epoch FROM schedule_items s JOIN users u ON u.id = s.student_id
    WHERE s.status = 'pending' AND s.suppressed_by_schedule_item_id IS NULL
      AND ((s.family_date + 1 + TIME '22:00') AT TIME ZONE 'Asia/Shanghai') <= ${now.toISOString()}::timestamptz
      AND u.status = 'active' AND (u.role <> 'student' OR u.birth_date + INTERVAL '19 years' > ${familyDate}::date)
      AND NOT EXISTS (SELECT 1 FROM deletion_requests d WHERE d.student_id = s.student_id AND d.target_type = 'student_account' AND d.status IN ('requested','frozen'))
      AND NOT EXISTS (SELECT 1 FROM outbox_events o WHERE o.dedupe_key = 'lifecycle.schedule_due:' || s.id::text || ':' || u.authorization_epoch::text)
    ORDER BY s.family_date, s.id LIMIT ${limit}
  `);
  for (const row of schedules as unknown as Array<{
    id: string;
    student_id: string;
    authorization_epoch: number;
  }>) {
    await appendOutboxEvent(db, {
      aggregateType: "schedule_item",
      aggregateId: row.id,
      eventType: "lifecycle.schedule_due",
      dedupeKey: `lifecycle.schedule_due:${row.id}:${row.authorization_epoch}`,
      payload: { scheduleItemId: row.id, studentId: row.student_id },
    });
    count += 1;
  }
  const deletions = await db.execute(sql`
    SELECT id FROM deletion_requests d WHERE status = 'frozen'
      AND ((student_confirmed_at IS NOT NULL AND revocable_until <= ${now.toISOString()}::timestamptz) OR admin_force_reason IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM outbox_events o WHERE o.dedupe_key = 'lifecycle.deletion_due:' || d.id::text)
    ORDER BY revocable_until, id LIMIT ${limit}
  `);
  for (const row of deletions as unknown as Array<{ id: string }>) {
    await appendOutboxEvent(db, {
      aggregateType: "deletion_request",
      aggregateId: row.id,
      eventType: "lifecycle.deletion_due",
      dedupeKey: `lifecycle.deletion_due:${row.id}`,
      payload: { requestId: row.id },
    });
    count += 1;
  }
  const adults = await db.execute(sql`
    SELECT id, authorization_epoch FROM users u WHERE role = 'student' AND status = 'active' AND birth_date + INTERVAL '19 years' <= ${familyDate}::date
      AND NOT EXISTS (SELECT 1 FROM deletion_requests d WHERE d.student_id = u.id AND d.target_type = 'student_account' AND d.status IN ('requested','frozen'))
      AND NOT EXISTS (SELECT 1 FROM outbox_events o WHERE o.dedupe_key = 'lifecycle.age_due:' || u.id::text || ':' || u.authorization_epoch::text)
    ORDER BY birth_date, id LIMIT ${limit}
  `);
  for (const row of adults as unknown as Array<{ id: string; authorization_epoch: number }>) {
    await appendOutboxEvent(db, {
      aggregateType: "user",
      aggregateId: row.id,
      eventType: "lifecycle.age_due",
      dedupeKey: `lifecycle.age_due:${row.id}:${row.authorization_epoch}`,
      payload: { studentId: row.id },
    });
    count += 1;
  }
  return count;
}

export async function processDueSchedule(
  db: Database,
  studentId: string,
  scheduleItemId: string,
  now = new Date(),
): Promise<void> {
  await db.transaction(async (tx) => {
    await lockLedgerSubject(tx, studentId);
    if (await isStudentAccountFrozen(tx, studentId)) return;
    const [subject] = await tx.select().from(users).where(eq(users.id, studentId)).limit(1);
    if (!subject || subject.status !== "active") return;
    if (
      subject.role === "student" &&
      subject.birthDate &&
      ageInYearsAt(new Date(`${subject.birthDate}T00:00:00+08:00`), now) >= 19
    )
      return;
    await assertSubjectAccess(tx, studentId, "write", now);
    await persistExpiredPastWindow(tx, studentId, now, {
      scheduleItemIds: [scheduleItemId],
      limit: 1,
    });
  });
}

export async function archiveAdultStudent(
  db: Database,
  studentId: string,
  now = new Date(),
): Promise<void> {
  await db.transaction(async (tx) => {
    await lockLedgerSubject(tx, studentId);
    const [subject] = await tx.select().from(users).where(eq(users.id, studentId)).limit(1);
    if (
      !subject ||
      subject.role !== "student" ||
      !subject.birthDate ||
      ageInYearsAt(new Date(`${subject.birthDate}T00:00:00+08:00`), now) < 19 ||
      (await isStudentAccountFrozen(tx, studentId))
    )
      return;
    const cancelled = await tx
      .update(scheduleItems)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(scheduleItems.studentId, studentId),
          eq(scheduleItems.status, "pending"),
          gte(scheduleItems.familyDate, toFamilyDate(now)),
        ),
      )
      .returning({ id: scheduleItems.id });
    await tx
      .update(plans)
      .set({ status: "inactive" })
      .where(and(eq(plans.studentId, studentId), eq(plans.status, "active")));
    await appendAuditEvent(tx, {
      action: "student.age_archived",
      resourceType: "user",
      resourceId: studentId,
      idempotencyKey: `student.age_archived:${studentId}`,
      metadata: { cancelledCount: cancelled.length, familyDate: toFamilyDate(now) },
    });
    await appendOutboxEvent(tx, {
      aggregateType: "user",
      aggregateId: studentId,
      eventType: "student.age_archived",
      dedupeKey: `student.age_archived:${studentId}`,
      payload: { studentId },
    });
  });
}
