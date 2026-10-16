import { and, eq, sql } from "drizzle-orm";
import type { Database } from "@/db";
import {
  factVersions,
  planItemRules,
  scheduleExecutionCommands,
  scheduleItems,
  scheduleTaskExecutions,
} from "@/db/schema";
import { appendAuditEvent } from "@/modules/audit/append-audit-event";
import { assertSubjectAccess } from "@/modules/data-lifecycle/subject-access.service";
import { requireActiveRelationship } from "@/modules/family-access/authorization.service";
import { appendOutboxEvent } from "@/modules/outbox/append-outbox-event";
import { ScheduleError } from "@/modules/schedule/errors";
import {
  executionChecklistSchema,
  executionEditDeadline,
  finishExecution,
  readChecklist,
  readPomodoro,
  transitionPomodoro,
  validateFinalPomodoro,
  type ChecklistTask,
  type ExecutionSnapshot,
  type Pomodoro,
} from "@/modules/schedule/execution-state";
import { hashIdempotencyPayload } from "@/modules/schedule/normalize-idempotency-payload";
import { reverseLedgerEntriesForFact } from "@/modules/settlement/error-count-settlement.service";
import { settleForFact } from "@/modules/settlement/settlement.service";
import { isWithinCompletionWindow } from "@/modules/time-policy/completion-window";
import { deriveCompletionKind } from "@/modules/time-policy/derive-completion-kind";

export type UpdateTaskExecutionInput = {
  actorId: string;
  actorRole: "parent" | "student";
  scheduleItemId: string;
  idempotencyKey: string;
  expectedRevision: number;
  checklist?: ChecklistTask[];
  pomodoroAction?: "start" | "pause" | "resume" | "stop";
  subtaskId?: string;
  pomodoro?: Pomodoro;
  reason?: string;
  startedAt?: string;
  completedAt?: string;
  durationMinutes?: number;
  correction?: boolean;
  now?: Date;
  requestId?: string;
};
export type UpdateTaskExecutionResult = {
  revision: number;
  checklist: ChecklistTask[];
  pomodoro: Pomodoro;
  taskType: ExecutionSnapshot["taskType"];
  factVersionId?: string;
  predecessorFactId?: string;
  reversalLedgerEntryIds?: string[];
  settlementId?: string;
  ledgerEntryId?: string;
  idempotentReplay: boolean;
};

function validateTaskIntervals(checklist: ChecklistTask[], now: Date) {
  for (const task of checklist) {
    const start = task.startedAt ? new Date(task.startedAt) : null;
    const end = task.completedAt ? new Date(task.completedAt) : null;
    if ((start && start > now) || (end && end > now) || (start && end && start > end))
      throw new ScheduleError("VALIDATION_ERROR", "子任务开始和结束时间不正确");
  }
}

export async function updateTaskExecution(
  db: Database,
  input: UpdateTaskExecutionInput,
): Promise<UpdateTaskExecutionResult> {
  const now = input.now ?? new Date();
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0)
    throw new ScheduleError("VALIDATION_ERROR", "请提供当前执行记录版本");
  if (input.completedAt && input.durationMinutes !== undefined)
    throw new ScheduleError("VALIDATION_ERROR", "结束时间和时长只能填写一项");
  if (input.correction && (!input.reason || input.reason.trim().length < 2))
    throw new ScheduleError("VALIDATION_ERROR", "请填写更正原因");
  const payloadHash = hashIdempotencyPayload({
    expectedRevision: input.expectedRevision,
    checklist: input.checklist,
    pomodoroAction: input.pomodoroAction,
    subtaskId: input.subtaskId,
    pomodoro: input.pomodoro,
    reason: input.reason,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    durationMinutes: input.durationMinutes,
    correction: input.correction ?? false,
  });
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
    if (!item) throw new ScheduleError("NOT_FOUND", "日程不存在");
    if (input.actorRole === "student" && item.studentId !== input.actorId)
      throw new ScheduleError("FORBIDDEN", "学生只能编辑自己的日程");
    if (input.actorRole === "parent" && item.studentId !== input.actorId)
      await requireActiveRelationship(tx, input.actorId, item.studentId);
    const [command] = await tx
      .select()
      .from(scheduleExecutionCommands)
      .where(
        and(
          eq(scheduleExecutionCommands.actorId, input.actorId),
          eq(scheduleExecutionCommands.scheduleItemId, item.id),
          eq(scheduleExecutionCommands.key, input.idempotencyKey),
        ),
      )
      .limit(1);
    if (command) {
      if (command.payloadHash !== payloadHash)
        throw new ScheduleError("IDEMPOTENCY_CONFLICT", "执行更新请求内容不一致");
      return { ...command.result, idempotentReplay: true } as UpdateTaskExecutionResult;
    }
    if (item.status !== "pending" && item.status !== "completed")
      throw new ScheduleError("STATE_CONFLICT", "当前日程不能编辑执行记录");
    if (item.suppressedByScheduleItemId)
      throw new ScheduleError("STATE_CONFLICT", "该日程已被更高优先级计划覆盖");
    if (item.status === "completed") {
      if (now >= executionEditDeadline(item.familyDate, input.actorRole))
        throw new ScheduleError("WINDOW_EXPIRED", "已超过该已完成任务的可编辑期限");
      if (input.pomodoroAction)
        throw new ScheduleError("STATE_CONFLICT", "已完成任务请直接更正最终计时记录");
    } else if (!isWithinCompletionWindow(item.familyDate, now))
      throw new ScheduleError("WINDOW_EXPIRED", "尚未到任务日期或已超过完成期限");
    if (input.correction && item.status !== "completed")
      throw new ScheduleError("STATE_CONFLICT", "只能更正已完成任务");
    const [rule] = await tx
      .select()
      .from(planItemRules)
      .where(eq(planItemRules.scheduleItemId, item.id))
      .limit(1);
    const [previous] = await tx
      .select()
      .from(scheduleTaskExecutions)
      .where(eq(scheduleTaskExecutions.scheduleItemId, item.id))
      .limit(1);
    if ((previous?.revision ?? 0) !== input.expectedRevision)
      throw new ScheduleError("STATE_CONFLICT", "执行记录已更新，请刷新后再修改");
    const taskType =
      rule?.entry.taskType === "homework" || rule?.entry.taskType === "exercise"
        ? rule.entry.taskType
        : "normal";
    const fixed = readChecklist(rule?.entry.checklist);
    let checklist = input.checklist
      ? executionChecklistSchema.parse(input.checklist)
      : readChecklist(previous?.checklist ?? rule?.entry.checklist);
    if (taskType === "exercise" && checklist.length)
      throw new ScheduleError("VALIDATION_ERROR", "运动任务不支持子任务清单");
    if (
      taskType === "normal" &&
      input.checklist &&
      (checklist.length !== fixed.length ||
        checklist.some(
          (task, index) => task.id !== fixed[index]?.id || task.title !== fixed[index]?.title,
        ))
    )
      throw new ScheduleError("VALIDATION_ERROR", "普通任务只能勾选预设子任务");
    validateTaskIntervals(checklist, now);
    if (item.status === "pending" && input.checklist) {
      const previousTasks = readChecklist(previous?.checklist);
      if (
        checklist.some(
          (task) =>
            hashIdempotencyPayload(task.pomodoro ?? {}) !==
            hashIdempotencyPayload(
              previousTasks.find((saved) => saved.id === task.id)?.pomodoro ?? {},
            ),
        )
      )
        throw new ScheduleError("VALIDATION_ERROR", "番茄钟请使用开始、暂停、继续和停止操作");
    }
    if (item.status === "completed")
      checklist = checklist.map((task) => ({
        ...task,
        ...(task.pomodoro ? { pomodoro: validateFinalPomodoro(task.pomodoro, now) } : {}),
      }));
    let pomodoro = readPomodoro(previous?.pomodoro);
    if (input.pomodoro) {
      if (
        item.status !== "completed" ||
        input.pomodoro.state === "running" ||
        input.pomodoro.state === "paused"
      )
        throw new ScheduleError("VALIDATION_ERROR", "只能更正已完成任务的最终计时");
      pomodoro = validateFinalPomodoro(input.pomodoro, now);
    }
    if (input.pomodoroAction) {
      if (taskType === "normal")
        throw new ScheduleError("VALIDATION_ERROR", "普通任务不使用番茄钟");
      if (input.subtaskId) {
        if (taskType !== "homework")
          throw new ScheduleError("VALIDATION_ERROR", "只有作业支持子任务计时");
        if (!checklist.some((task) => task.id === input.subtaskId))
          throw new ScheduleError("NOT_FOUND", "作业子任务不存在");
        checklist = checklist.map((task) => {
          if (task.id !== input.subtaskId) return task;
          const timer = transitionPomodoro(readPomodoro(task.pomodoro), input.pomodoroAction!, now);
          return {
            ...task,
            pomodoro: timer,
            startedAt: timer.startedAt,
            ...(timer.stoppedAt ? { completedAt: timer.stoppedAt } : {}),
          };
        });
      } else pomodoro = transitionPomodoro(pomodoro, input.pomodoroAction, now);
    }
    let snapshot: ExecutionSnapshot = {
      revision: input.expectedRevision + 1,
      taskType,
      checklist,
      pomodoro,
      all_completed: checklist.every((task) => task.completed),
    };
    let corrected: Partial<UpdateTaskExecutionResult> = {};
    if (item.status === "completed") {
      snapshot = finishExecution(snapshot, now);
      const [predecessor] = await tx
        .select()
        .from(factVersions)
        .where(
          and(
            eq(factVersions.scheduleItemId, item.id),
            eq(factVersions.factKey, "schedule.completed"),
            sql`NOT EXISTS (SELECT 1 FROM fact_versions successor WHERE successor.supersedes_fact_version_id = ${factVersions.id})`,
          ),
        )
        .limit(1);
      if (!predecessor) throw new ScheduleError("STATE_CONFLICT", "缺少可更正的完成记录");
      const originalStart =
        typeof predecessor.value.started_at === "string" ? predecessor.value.started_at : undefined;
      const start = new Date(input.startedAt ?? originalStart ?? predecessor.occurredAt);
      const end =
        input.durationMinutes !== undefined
          ? new Date(start.getTime() + input.durationMinutes * 60_000)
          : new Date(input.completedAt ?? predecessor.occurredAt);
      if (
        !Number.isFinite(start.getTime()) ||
        !Number.isFinite(end.getTime()) ||
        start > end ||
        end > now ||
        !isWithinCompletionWindow(item.familyDate, start)
      )
        throw new ScheduleError(
          "VALIDATION_ERROR",
          "请填写任务日期起至次日22点前开始且不晚于当前时间的有效执行区间",
        );
      const completionKind = deriveCompletionKind(end, item.familyDate);
      const [successor] = await tx
        .insert(factVersions)
        .values({
          scheduleItemId: item.id,
          studentId: item.studentId,
          factKey: "schedule.completed",
          sourceKind: "manual",
          value: {
            started_at: start.toISOString(),
            completed_at: end.toISOString(),
            duration_minutes: (end.getTime() - start.getTime()) / 60_000,
            completion_kind: completionKind,
            execution: snapshot,
          },
          idempotencyKey: `execution:${input.actorId}:${input.idempotencyKey}`,
          idempotencyPayloadHash: payloadHash,
          completionKind,
          occurredAt: end,
          assertedAt: now,
          recordedAt: now,
          submittedBy: input.actorId,
          supersedesFactVersionId: predecessor.id,
          correctionReason: input.reason?.trim() || "更正任务执行记录",
        })
        .returning({ id: factVersions.id });
      if (!successor) throw new ScheduleError("STATE_CONFLICT", "更正保存失败");
      const reversalLedgerEntryIds = await reverseLedgerEntriesForFact(tx, {
        factVersionId: predecessor.id,
        studentId: item.studentId,
        actorId: input.actorId,
        idempotencyKey: input.idempotencyKey,
      });
      const settlement = await settleForFact(tx, { factVersionId: successor.id });
      corrected = {
        factVersionId: successor.id,
        predecessorFactId: predecessor.id,
        reversalLedgerEntryIds,
        ...settlement,
      };
    } else if (input.startedAt || input.completedAt || input.durationMinutes !== undefined)
      throw new ScheduleError("VALIDATION_ERROR", "执行区间请通过完成任务入口填写");
    await tx
      .insert(scheduleTaskExecutions)
      .values({
        scheduleItemId: item.id,
        taskType,
        revision: snapshot.revision,
        checklist: snapshot.checklist,
        pomodoro: snapshot.pomodoro,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: scheduleTaskExecutions.scheduleItemId,
        set: {
          revision: snapshot.revision,
          checklist: snapshot.checklist,
          pomodoro: snapshot.pomodoro,
          updatedAt: now,
        },
      });
    const result: UpdateTaskExecutionResult = {
      revision: snapshot.revision,
      checklist: snapshot.checklist,
      pomodoro: snapshot.pomodoro,
      taskType,
      ...corrected,
      idempotentReplay: false,
    };
    await tx.insert(scheduleExecutionCommands).values({
      actorId: input.actorId,
      scheduleItemId: item.id,
      key: input.idempotencyKey,
      payloadHash,
      result,
      createdAt: now,
    });
    await appendAuditEvent(tx, {
      actorId: input.actorId,
      action:
        item.status === "completed"
          ? "schedule.execution_corrected"
          : "schedule_task_execution.updated",
      resourceType: "schedule_item",
      resourceId: item.id,
      requestId: input.requestId ?? null,
      idempotencyKey: `audit:schedule-execution:${item.id}:${input.actorId}:${input.idempotencyKey}`,
      metadata: {
        payloadHash,
        taskType,
        revision: snapshot.revision,
        factVersionId: corrected.factVersionId ?? null,
      },
    });
    await appendOutboxEvent(tx, {
      aggregateType: "schedule_item",
      aggregateId: item.id,
      eventType: "schedule_task_execution.updated",
      dedupeKey: `schedule-execution:${item.id}:${input.actorId}:${input.idempotencyKey}`,
      payload: {
        scheduleItemId: item.id,
        taskType,
        revision: snapshot.revision,
        factVersionId: corrected.factVersionId ?? null,
      },
    });
    return result;
  });
}
