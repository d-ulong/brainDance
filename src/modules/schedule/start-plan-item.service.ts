import { and, eq, sql } from "drizzle-orm";
import type { Database } from "@/db";
import { factVersions, planItemRules, scheduleItems } from "@/db/schema";
import { appendAuditEvent } from "@/modules/audit/append-audit-event";
import { assertSubjectAccess } from "@/modules/data-lifecycle/subject-access.service";
import { requireActiveRelationship } from "@/modules/family-access/authorization.service";
import { appendOutboxEvent } from "@/modules/outbox/append-outbox-event";
import { ScheduleError } from "@/modules/schedule/errors";
import { hashIdempotencyPayload } from "@/modules/schedule/normalize-idempotency-payload";
import { isWithinCompletionWindow } from "@/modules/time-policy/completion-window";

export async function startPlanItem(
  db: Database,
  input: {
    actorId: string;
    actorRole?: "parent" | "student";
    scheduleItemId: string;
    idempotencyKey: string;
    now?: Date;
    requestId?: string;
  },
) {
  const now = input.now ?? new Date();
  const payloadHash = hashIdempotencyPayload({ actorId: input.actorId });
  const [preflight] = await db
    .select({ studentId: scheduleItems.studentId })
    .from(scheduleItems)
    .where(eq(scheduleItems.id, input.scheduleItemId))
    .limit(1);
  if (!preflight) throw new ScheduleError("NOT_FOUND", "日程不存在");
  return db.transaction(async (tx) => {
    await assertSubjectAccess(tx, preflight.studentId, "write", now);
    await tx.execute(
      sql`SELECT id FROM schedule_items WHERE id = ${input.scheduleItemId}::uuid FOR UPDATE`,
    );
    const [item] = await tx
      .select()
      .from(scheduleItems)
      .where(eq(scheduleItems.id, input.scheduleItemId))
      .limit(1);
    const [rule] = await tx
      .select()
      .from(planItemRules)
      .where(eq(planItemRules.scheduleItemId, input.scheduleItemId))
      .limit(1);
    if (!item || !rule) throw new ScheduleError("NOT_FOUND", "该日程不是可计时的计划内容");
    if ((input.actorRole ?? "student") === "student" && item.studentId !== input.actorId)
      throw new ScheduleError("FORBIDDEN", "学生只能开始自己的计划内容");
    if ((input.actorRole ?? "student") === "parent" && item.studentId !== input.actorId)
      await requireActiveRelationship(tx, input.actorId, item.studentId);
    const [replay] = await tx
      .select({
        id: factVersions.id,
        payloadHash: factVersions.idempotencyPayloadHash,
        value: factVersions.value,
        factKey: factVersions.factKey,
      })
      .from(factVersions)
      .where(
        and(
          eq(factVersions.scheduleItemId, item.id),
          eq(factVersions.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);
    if (replay) {
      if (replay.factKey !== "schedule.started" || replay.payloadHash !== payloadHash)
        throw new ScheduleError("IDEMPOTENCY_CONFLICT", "开始请求内容不一致");
      return {
        factVersionId: replay.id,
        startedAt: new Date(String(replay.value.started_at)),
        idempotentReplay: true,
      };
    }
    if (item.suppressedByScheduleItemId)
      throw new ScheduleError("STATE_CONFLICT", "该日程已被更高优先级计划覆盖");
    if (item.status !== "pending")
      throw new ScheduleError("STATE_CONFLICT", "日程已不处于待完成状态");
    if (!isWithinCompletionWindow(item.familyDate, now))
      throw new ScheduleError("WINDOW_EXPIRED", "尚未到任务日期或已超过完成期限");
    if (rule.startedAt) throw new ScheduleError("STATE_CONFLICT", "该内容已经开始");
    const [fact] = await tx
      .insert(factVersions)
      .values({
        scheduleItemId: item.id,
        studentId: item.studentId,
        factKey: "schedule.started",
        sourceKind: "system",
        value: { started_at: now.toISOString() },
        idempotencyKey: input.idempotencyKey,
        idempotencyPayloadHash: payloadHash,
        completionKind: "not_applicable",
        occurredAt: now,
        assertedAt: now,
        recordedAt: now,
      })
      .returning({ id: factVersions.id });
    if (!fact) throw new ScheduleError("STATE_CONFLICT", "开始事实保存失败");
    await tx
      .update(planItemRules)
      .set({ startedAt: now })
      .where(eq(planItemRules.scheduleItemId, item.id));
    await appendAuditEvent(tx, {
      actorId: input.actorId,
      action: "plan_item.started",
      resourceType: "schedule_item",
      resourceId: item.id,
      requestId: input.requestId ?? null,
      idempotencyKey: `audit:plan-started:${item.id}:${input.idempotencyKey}`,
      metadata: { factVersionId: fact.id },
    });
    await appendOutboxEvent(tx, {
      aggregateType: "schedule_item",
      aggregateId: item.id,
      eventType: "plan_item.started",
      dedupeKey: `plan_item.started:${item.id}`,
      payload: { scheduleItemId: item.id, factVersionId: fact.id },
    });
    return { factVersionId: fact.id, startedAt: now, idempotentReplay: false };
  });
}
