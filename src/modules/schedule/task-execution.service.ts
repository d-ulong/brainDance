import { eq, sql } from "drizzle-orm";

import type { Database } from "@/db";
import { planItemRules, scheduleItems, scheduleTaskExecutions } from "@/db/schema";
import { appendAuditEvent } from "@/modules/audit/append-audit-event";
import { assertStudentAccountNotFrozen } from "@/modules/data-lifecycle/freeze-guard.service";
import { requireActiveRelationship } from "@/modules/family-access/authorization.service";
import { appendOutboxEvent } from "@/modules/outbox/append-outbox-event";
import { ScheduleError } from "@/modules/schedule/errors";
import { hashIdempotencyPayload } from "@/modules/schedule/normalize-idempotency-payload";
import { addFamilyDays } from "@/modules/time-policy/add-family-days";
import { familyLocalInstant } from "@/modules/time-policy/family-local-instant";

type ChecklistTask = {
  id: string;
  title: string;
  completed: boolean;
  difficulty?: string;
  durationMinutes?: number;
};
type Pomodoro = {
  state?: "running" | "paused";
  startedAt?: string;
  pausedAt?: string;
  pauseCount?: number;
  pausedSeconds?: number;
};

function endOfEditWindow(familyDate: string, role: "parent" | "student") {
  return familyLocalInstant(
    role === "parent" ? addFamilyDays(familyDate, 60) : familyDate,
    "23:59:59.999",
  );
}

export async function updateTaskExecution(
  db: Database,
  input: {
    actorId: string;
    actorRole: "parent" | "student";
    scheduleItemId: string;
    idempotencyKey: string;
    checklist?: ChecklistTask[];
    pomodoroAction?: "start" | "pause" | "resume";
    now?: Date;
    requestId?: string;
  },
) {
  const now = input.now ?? new Date();
  const payloadHash = hashIdempotencyPayload({
    checklist: input.checklist,
    pomodoroAction: input.pomodoroAction,
  });
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT id FROM schedule_items WHERE id = ${input.scheduleItemId}::uuid FOR UPDATE`,
    );
    const [item] = await tx
      .select()
      .from(scheduleItems)
      .where(eq(scheduleItems.id, input.scheduleItemId))
      .limit(1);
    if (!item) throw new ScheduleError("NOT_FOUND", "日程不存在");
    if (input.actorRole === "student" && item.studentId !== input.actorId)
      throw new ScheduleError("FORBIDDEN", "学生只能编辑自己的日程");
    if (input.actorRole === "parent" && item.studentId !== input.actorId)
      await requireActiveRelationship(tx, input.actorId, item.studentId);
    await assertStudentAccountNotFrozen(tx, item.studentId, "write");
    if (item.status === "completed" && now > endOfEditWindow(item.familyDate, input.actorRole))
      throw new ScheduleError("WINDOW_EXPIRED", "已超过该已完成任务的可编辑期限");
    if (item.status !== "pending" && item.status !== "completed")
      throw new ScheduleError("STATE_CONFLICT", "当前日程不能编辑执行记录");
    const [rule] = await tx
      .select()
      .from(planItemRules)
      .where(eq(planItemRules.scheduleItemId, item.id))
      .limit(1);
    if (!rule) throw new ScheduleError("NOT_FOUND", "该日程没有任务定义");
    const taskType =
      rule.entry.taskType === "homework" || rule.entry.taskType === "exercise"
        ? rule.entry.taskType
        : "normal";
    const fixed = Array.isArray(rule.entry.checklist) ? rule.entry.checklist : [];
    if (taskType === "exercise" && input.checklist?.length)
      throw new ScheduleError("VALIDATION_ERROR", "运动任务不支持子任务清单");
    if (
      taskType === "normal" &&
      input.checklist &&
      (input.checklist.length !== fixed.length ||
        input.checklist.some(
          (task, index) => task.id !== fixed[index]?.id || task.title !== fixed[index]?.title,
        ))
    )
      throw new ScheduleError("VALIDATION_ERROR", "普通任务只能勾选预设子任务");
    if (taskType === "homework" && input.checklist?.some((task) => !task.id || !task.title.trim()))
      throw new ScheduleError("VALIDATION_ERROR", "作业子学习任务必须填写名称");
    const [previous] = await tx
      .select()
      .from(scheduleTaskExecutions)
      .where(eq(scheduleTaskExecutions.scheduleItemId, item.id))
      .limit(1);
    const pomodoro = { ...(previous?.pomodoro ?? {}) } as Pomodoro;
    if (input.pomodoroAction === "start" || input.pomodoroAction === "resume") {
      if (pomodoro.pausedAt)
        pomodoro.pausedSeconds =
          (pomodoro.pausedSeconds ?? 0) +
          Math.max(0, Math.floor((now.getTime() - new Date(pomodoro.pausedAt).getTime()) / 1000));
      pomodoro.state = "running";
      pomodoro.startedAt ??= now.toISOString();
      delete pomodoro.pausedAt;
    }
    if (input.pomodoroAction === "pause") {
      if (pomodoro.state !== "running") throw new ScheduleError("STATE_CONFLICT", "番茄钟尚未开始");
      pomodoro.state = "paused";
      pomodoro.pausedAt = now.toISOString();
      pomodoro.pauseCount = (pomodoro.pauseCount ?? 0) + 1;
    }
    const checklist =
      input.checklist ??
      (Array.isArray(previous?.checklist)
        ? previous.checklist
        : fixed.map((task) => ({ ...task, completed: false })));
    await tx
      .insert(scheduleTaskExecutions)
      .values({ scheduleItemId: item.id, taskType, checklist, pomodoro, updatedAt: now })
      .onConflictDoUpdate({
        target: scheduleTaskExecutions.scheduleItemId,
        set: { checklist, pomodoro, updatedAt: now },
      });
    await appendAuditEvent(tx, {
      actorId: input.actorId,
      action: "schedule_task_execution.updated",
      resourceType: "schedule_item",
      resourceId: item.id,
      requestId: input.requestId ?? null,
      idempotencyKey: `audit:schedule-execution:${input.idempotencyKey}`,
      metadata: { payloadHash, taskType },
    });
    await appendOutboxEvent(tx, {
      aggregateType: "schedule_item",
      aggregateId: item.id,
      eventType: "schedule_task_execution.updated",
      dedupeKey: `schedule-execution:${item.id}:${input.idempotencyKey}`,
      payload: { scheduleItemId: item.id, taskType },
    });
    return { checklist, pomodoro, taskType };
  });
}
