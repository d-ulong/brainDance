import { and, eq, gte, lte, sql } from "drizzle-orm";

import type { Database } from "@/db";
import { auditEvents, planItemRules, scheduleItems } from "@/db/schema";
import { appendAuditEvent } from "@/modules/audit/append-audit-event";
import { assertStudentAccountNotFrozen } from "@/modules/data-lifecycle/freeze-guard.service";
import { requireActiveRelationship } from "@/modules/family-access/authorization.service";
import { appendOutboxEvent } from "@/modules/outbox/append-outbox-event";
import { ScheduleError } from "@/modules/schedule/errors";
import { hashIdempotencyPayload } from "@/modules/schedule/normalize-idempotency-payload";
import { toFamilyDate } from "@/modules/time-policy/to-family-date";

export type ClearScheduleInput = {
  actorId: string;
  actorRole: string;
  studentId: string;
  from: string;
  through: string;
  idempotencyKey: string;
  now?: Date;
  requestId?: string;
};

export type ClearScheduleResult = { clearedCount: number; idempotentReplay: boolean };

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export async function clearScheduleItems(db: Database, input: ClearScheduleInput): Promise<ClearScheduleResult> {
  const today = toFamilyDate(input.now ?? new Date());
  if (input.from < today || input.from > addDays(today, 89) || input.through < input.from || input.through > addDays(today, 89) || input.through > addDays(input.from, 89)) {
    throw new ScheduleError("VALIDATION_ERROR", "只能清除今天及之后、连续不超过 90 天的日程");
  }
  if (input.actorRole === "student") {
    if (input.actorId !== input.studentId) throw new ScheduleError("FORBIDDEN", "学生只能清除自己的日程");
  } else if (input.actorRole === "parent") {
    await requireActiveRelationship(db, input.actorId, input.studentId);
  } else {
    throw new ScheduleError("FORBIDDEN", "当前账号不能清除日程");
  }
  await assertStudentAccountNotFrozen(db, input.studentId, "write");

  const payloadHash = hashIdempotencyPayload({ studentId: input.studentId, from: input.from, through: input.through });
  const auditKey = `audit:schedule-cleared:${input.actorId}:${input.idempotencyKey}`;
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${auditKey}))`);
    const [replay] = await tx.select({ metadata: auditEvents.metadata }).from(auditEvents).where(eq(auditEvents.idempotencyKey, auditKey)).limit(1);
    if (replay) {
      if (replay.metadata?.payloadHash !== payloadHash) throw new ScheduleError("IDEMPOTENCY_CONFLICT", "清除日程请求内容不一致");
      return { clearedCount: Number(replay.metadata?.clearedCount ?? 0), idempotentReplay: true };
    }

    await tx.execute(sql`SELECT id FROM schedule_items WHERE student_id = ${input.studentId}::uuid AND family_date BETWEEN ${input.from}::date AND ${input.through}::date FOR UPDATE`);
    const conditions = [
      eq(scheduleItems.studentId, input.studentId),
      eq(scheduleItems.status, "pending"),
      gte(scheduleItems.familyDate, input.from),
      lte(scheduleItems.familyDate, input.through),
      sql`NOT EXISTS (SELECT 1 FROM ${planItemRules} WHERE ${planItemRules.scheduleItemId} = ${scheduleItems.id} AND ${planItemRules.startedAt} IS NOT NULL)`,
    ];
    if (input.actorRole === "student") conditions.push(eq(scheduleItems.ownerId, input.actorId));
    const cleared = await tx.update(scheduleItems).set({ status: "cancelled" }).where(and(...conditions)).returning({ id: scheduleItems.id });

    await appendAuditEvent(tx, {
      actorId: input.actorId,
      action: "schedule_items.cleared",
      resourceType: "student_schedule",
      resourceId: input.studentId,
      requestId: input.requestId ?? null,
      idempotencyKey: auditKey,
      metadata: { payloadHash, clearedCount: cleared.length, from: input.from, through: input.through },
    });
    await appendOutboxEvent(tx, {
      aggregateType: "student_schedule",
      aggregateId: input.studentId,
      eventType: "schedule.items_cleared",
      dedupeKey: `schedule.items_cleared:${input.actorId}:${input.idempotencyKey}`,
      payload: { schemaVersion: 1, studentId: input.studentId, clearedCount: cleared.length, from: input.from, through: input.through },
    });
    return { clearedCount: cleared.length, idempotentReplay: false };
  });
}
