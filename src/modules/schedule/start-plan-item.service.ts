import { and, eq, sql } from "drizzle-orm";

import type { Database } from "@/db";
import { factVersions, planItemRules, scheduleItems } from "@/db/schema";
import { appendAuditEvent } from "@/modules/audit/append-audit-event";
import { assertStudentAccountNotFrozen } from "@/modules/data-lifecycle/freeze-guard.service";
import { requireActiveRelationship } from "@/modules/family-access/authorization.service";
import { appendOutboxEvent } from "@/modules/outbox/append-outbox-event";
import { ScheduleError } from "@/modules/schedule/errors";
import { hashIdempotencyPayload } from "@/modules/schedule/normalize-idempotency-payload";

export async function startPlanItem(db: Database, input: { actorId: string; actorRole?: "parent" | "student"; scheduleItemId: string; idempotencyKey: string; now?: Date; requestId?: string }) {
  const now = input.now ?? new Date(); const payloadHash = hashIdempotencyPayload({});
  const [preflight] = await db.select({ studentId: scheduleItems.studentId }).from(scheduleItems).where(eq(scheduleItems.id, input.scheduleItemId)).limit(1);
  if (!preflight) throw new ScheduleError("NOT_FOUND", "日程不存在");
  if ((input.actorRole ?? "student") === "student") {
    if (preflight.studentId !== input.actorId) throw new ScheduleError("FORBIDDEN", "学生只能开始自己的计划内容");
  } else {
    await requireActiveRelationship(db, input.actorId, preflight.studentId);
  }
  await assertStudentAccountNotFrozen(db, preflight.studentId, "write");
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM schedule_items WHERE id = ${input.scheduleItemId}::uuid FOR UPDATE`);
    const [item] = await tx.select().from(scheduleItems).where(eq(scheduleItems.id, input.scheduleItemId)).limit(1);
    const [rule] = await tx.select().from(planItemRules).where(eq(planItemRules.scheduleItemId, input.scheduleItemId)).limit(1);
    if (!item || !rule) throw new ScheduleError("NOT_FOUND", "该日程不是可计时的计划内容");
    if (item.suppressedByScheduleItemId) throw new ScheduleError("STATE_CONFLICT", "该日程已被更高优先级计划覆盖");
    const [replay] = await tx.select({ id: factVersions.id, payloadHash: factVersions.idempotencyPayloadHash }).from(factVersions).where(and(eq(factVersions.scheduleItemId, item.id), eq(factVersions.idempotencyKey, input.idempotencyKey))).limit(1);
    if (replay) { if (replay.payloadHash !== payloadHash) throw new ScheduleError("IDEMPOTENCY_CONFLICT", "开始请求内容不一致"); return { factVersionId: replay.id, startedAt: rule.startedAt ?? now, idempotentReplay: true }; }
    if (item.status !== "pending") throw new ScheduleError("STATE_CONFLICT", "日程已不处于待完成状态");
    if (rule.startedAt) throw new ScheduleError("STATE_CONFLICT", "该内容已经开始");
    if ((input.actorRole ?? "student") === "parent") await requireActiveRelationship(tx, input.actorId, item.studentId);
    // A start fact is system-shaped by the immutable fact constraint. The actual
    // operator is preserved by the surrounding audit record; parent completion
    // remains a manual fact with submittedBy and an execution interval.
    const [fact] = await tx.insert(factVersions).values({ scheduleItemId: item.id, studentId: item.studentId, factKey: "schedule.started", sourceKind: "system", value: { started_at: now.toISOString() }, idempotencyKey: input.idempotencyKey, idempotencyPayloadHash: payloadHash, completionKind: "not_applicable", occurredAt: now, assertedAt: now, recordedAt: now }).returning({ id: factVersions.id });
    if (!fact) throw new ScheduleError("STATE_CONFLICT", "开始事实保存失败");
    await tx.update(planItemRules).set({ startedAt: now }).where(eq(planItemRules.scheduleItemId, item.id));
    await appendAuditEvent(tx, { actorId: input.actorId, action: "plan_item.started", resourceType: "schedule_item", resourceId: item.id, requestId: input.requestId ?? null, idempotencyKey: `audit:plan-started:${input.idempotencyKey}`, metadata: { factVersionId: fact.id } });
    await appendOutboxEvent(tx, { aggregateType: "schedule_item", aggregateId: item.id, eventType: "plan_item.started", dedupeKey: `plan_item.started:${item.id}`, payload: { scheduleItemId: item.id, factVersionId: fact.id } });
    return { factVersionId: fact.id, startedAt: now, idempotentReplay: false };
  });
}
