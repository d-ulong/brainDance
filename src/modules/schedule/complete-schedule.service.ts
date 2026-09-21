import { and, eq, sql } from "drizzle-orm";

import type { Database } from "@/db";
import {
  factVersions,
  planItemRules,
  scheduleEvents,
  scheduleItems,
  scheduleTaskExecutions,
} from "@/db/schema";
import { appendAuditEvent } from "@/modules/audit/append-audit-event";
import { appendOutboxEvent } from "@/modules/outbox/append-outbox-event";
import { hashIdempotencyPayload } from "@/modules/schedule/normalize-idempotency-payload";
import { persistExpiredPastWindow } from "@/modules/schedule/persist-expired.service";
import { ScheduleError } from "@/modules/schedule/errors";
import { assertStudentAccountNotFrozen } from "@/modules/data-lifecycle/freeze-guard.service";
import { requireActiveRelationship } from "@/modules/family-access/authorization.service";
import { deriveCompletionKind } from "@/modules/time-policy/derive-completion-kind";
import { isPastCompletionWindow } from "@/modules/time-policy/completion-window";
import { isPastPlanSettlementDeadline } from "@/modules/time-policy/plan-settlement-deadline";
import { toFamilyDate } from "@/modules/time-policy/to-family-date";
import { SettlementError } from "@/modules/settlement/errors";
import {
  loadSettlementReplayForFact,
  settleForFact as defaultSettleForFact,
  type SettleForFactResult,
} from "@/modules/settlement/settlement.service";

export type SettleForFactInput = {
  factVersionId: string;
};

/** Phase 4 settlement seam — invoked in the same transaction as fact creation. */
export type SettleForFactFn = (
  tx: Database,
  input: SettleForFactInput,
) => Promise<SettleForFactResult>;

export type CompleteScheduleInput = {
  actorId: string;
  actorRole?: "parent" | "student";
  scheduleItemId: string;
  idempotencyKey: string;
  body?: Record<string, unknown> & {
    startedAt?: string;
    completedAt?: string;
    durationMinutes?: number;
  };
  now?: Date;
  requestId?: string;
  settleForFact?: SettleForFactFn;
};

export type CompleteScheduleResult = {
  scheduleItemId: string;
  eventId: string;
  factVersionId: string;
  completionKind: "on_time" | "late";
  settlementId: string;
  ledgerEntryId: string;
  idempotentReplay: boolean;
};

type LockedItem = typeof scheduleItems.$inferSelect;

async function lockScheduleItem(tx: Database, scheduleItemId: string): Promise<LockedItem> {
  await tx.execute(
    sql`SELECT id FROM schedule_items WHERE id = ${scheduleItemId}::uuid FOR UPDATE`,
  );

  const [item] = await tx
    .select()
    .from(scheduleItems)
    .where(eq(scheduleItems.id, scheduleItemId))
    .limit(1);

  if (!item) {
    throw new ScheduleError("NOT_FOUND", "Schedule item not found");
  }
  if (item.suppressedByScheduleItemId) {
    throw new ScheduleError("STATE_CONFLICT", "该日程已被更高优先级计划覆盖");
  }

  return item;
}

function assertCompleteEventReplayMatch(
  existing: typeof scheduleEvents.$inferSelect,
  input: { actorId: string; bodyHash: string },
): void {
  if (
    existing.actorId !== input.actorId ||
    existing.idempotencyPayloadHash !== input.bodyHash ||
    existing.toStatus !== "completed"
  ) {
    throw new ScheduleError("IDEMPOTENCY_CONFLICT", "Schedule event idempotency conflict");
  }
}

async function loadCompleteReplay(
  tx: Database,
  scheduleItemId: string,
  idempotencyKey: string,
): Promise<CompleteScheduleResult> {
  const [event] = await tx
    .select()
    .from(scheduleEvents)
    .where(
      and(
        eq(scheduleEvents.scheduleItemId, scheduleItemId),
        eq(scheduleEvents.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);

  if (!event || event.toStatus !== "completed" || !event.completionKind) {
    throw new ScheduleError("STATE_CONFLICT", "Complete replay event missing");
  }

  const [fact] = await tx
    .select({ id: factVersions.id })
    .from(factVersions)
    .where(
      and(
        eq(factVersions.scheduleItemId, scheduleItemId),
        eq(factVersions.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);

  if (!fact) {
    throw new ScheduleError("STATE_CONFLICT", "Complete replay fact missing");
  }

  let settlement: SettleForFactResult;
  try {
    settlement = await loadSettlementReplayForFact(tx, fact.id);
  } catch (error) {
    if (error instanceof SettlementError && error.code === "STATE_CONFLICT") {
      throw new ScheduleError("STATE_CONFLICT", error.message);
    }
    throw error;
  }

  return {
    scheduleItemId,
    eventId: event.id,
    factVersionId: fact.id,
    completionKind: event.completionKind as "on_time" | "late",
    settlementId: settlement.settlementId,
    ledgerEntryId: settlement.ledgerEntryId,
    idempotentReplay: true,
  };
}

export async function completeScheduleItem(
  db: Database,
  input: CompleteScheduleInput,
): Promise<CompleteScheduleResult> {
  const now = input.now ?? new Date();
  const bodyHash = hashIdempotencyPayload(input.body ?? {});

  const [preflightItem] = await db
    .select({ id: scheduleItems.id, studentId: scheduleItems.studentId })
    .from(scheduleItems)
    .where(eq(scheduleItems.id, input.scheduleItemId))
    .limit(1);

  if (!preflightItem) {
    throw new ScheduleError("NOT_FOUND", "Schedule item not found");
  }

  if ((input.actorRole ?? "student") === "student") {
    if (preflightItem.studentId !== input.actorId)
      throw new ScheduleError("FORBIDDEN", "学生只能完成自己的日程");
  } else if (preflightItem.studentId !== input.actorId) {
    await requireActiveRelationship(db, input.actorId, preflightItem.studentId);
  }

  await assertStudentAccountNotFrozen(db, preflightItem.studentId, "write");

  let expiredStudentId: string | null = null;

  try {
    return await db.transaction(async (tx) => {
      const item = await lockScheduleItem(tx, input.scheduleItemId);
      if ((input.actorRole ?? "student") === "parent" && item.studentId !== input.actorId) {
        await requireActiveRelationship(tx, input.actorId, item.studentId);
      }

      const [existingEvent] = await tx
        .select()
        .from(scheduleEvents)
        .where(
          and(
            eq(scheduleEvents.scheduleItemId, input.scheduleItemId),
            eq(scheduleEvents.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);

      if (existingEvent) {
        assertCompleteEventReplayMatch(existingEvent, {
          actorId: input.actorId,
          bodyHash,
        });
        return loadCompleteReplay(tx, input.scheduleItemId, input.idempotencyKey);
      }

      if (item.status !== "pending") {
        throw new ScheduleError("STATE_CONFLICT", "Schedule item is not pending");
      }

      const [planRule] = await tx
        .select({
          id: planItemRules.scheduleItemId,
          startedAt: planItemRules.startedAt,
          entry: planItemRules.entry,
        })
        .from(planItemRules)
        .where(eq(planItemRules.scheduleItemId, item.id))
        .limit(1);
      const taskType =
        planRule?.entry.taskType === "homework" || planRule?.entry.taskType === "exercise"
          ? planRule.entry.taskType
          : "normal";
      const configuredChecklist = Array.isArray(planRule?.entry.checklist)
        ? planRule.entry.checklist
        : [];
      const [execution] = await tx
        .select({ checklist: scheduleTaskExecutions.checklist })
        .from(scheduleTaskExecutions)
        .where(eq(scheduleTaskExecutions.scheduleItemId, item.id))
        .limit(1);
      const checklist = Array.isArray(execution?.checklist)
        ? execution.checklist
        : configuredChecklist;
      if (taskType !== "exercise" && checklist.some((entry) => entry.completed !== true)) {
        throw new ScheduleError("STATE_CONFLICT", "请先完成全部子任务，再完成主任务");
      }
      if (
        planRule
          ? isPastPlanSettlementDeadline(item.familyDate, now)
          : isPastCompletionWindow(item.familyDate, now)
      ) {
        expiredStudentId = item.studentId;
        throw new ScheduleError("WINDOW_EXPIRED", "Completion window has expired");
      }

      let startedAt = planRule?.startedAt ?? null;
      let completedAt = now;
      const manualExecution = Boolean(
        input.body?.startedAt ||
        input.body?.completedAt ||
        input.body?.durationMinutes ||
        (input.actorRole ?? "student") === "parent",
      );
      if (manualExecution) {
        if (!startedAt) {
          if (!input.body?.startedAt) throw new ScheduleError("VALIDATION_ERROR", "请填写开始时间");
          startedAt = new Date(input.body.startedAt);
        }
        if (input.body?.completedAt) completedAt = new Date(input.body.completedAt);
        else if (input.body?.durationMinutes !== undefined)
          completedAt = new Date(startedAt.getTime() + input.body.durationMinutes * 60_000);
        else throw new ScheduleError("VALIDATION_ERROR", "请填写结束时间或完成时长");
        if (!Number.isFinite(startedAt.getTime()) || !Number.isFinite(completedAt.getTime()))
          throw new ScheduleError("VALIDATION_ERROR", "执行时间格式不正确");
        if (toFamilyDate(startedAt) !== item.familyDate)
          throw new ScheduleError("VALIDATION_ERROR", "开始时间必须在任务日期当天");
        if (completedAt <= startedAt)
          throw new ScheduleError("VALIDATION_ERROR", "结束时间必须晚于开始时间");
        if (completedAt > now) {
          throw new ScheduleError(
            "VALIDATION_ERROR",
            input.body?.durationMinutes !== undefined
              ? "开始时间加完成时长不能晚于当前时间，请缩短时长或调整开始时间"
              : "结束时间不能晚于当前时间",
          );
        }
        if (planRule && !planRule.startedAt)
          await tx
            .update(planItemRules)
            .set({ startedAt })
            .where(eq(planItemRules.scheduleItemId, item.id));
      }

      const completionKind = deriveCompletionKind(completedAt, item.familyDate);

      const [event] = await tx
        .insert(scheduleEvents)
        .values({
          scheduleItemId: item.id,
          actorId: input.actorId,
          fromStatus: "pending",
          toStatus: "completed",
          idempotencyKey: input.idempotencyKey,
          idempotencyPayloadHash: bodyHash,
          completionKind,
          reason: null,
          occurredAt: completedAt,
        })
        .returning();

      if (!event) {
        throw new Error("Failed to create schedule event");
      }

      await tx
        .update(scheduleItems)
        .set({ status: "completed" })
        .where(eq(scheduleItems.id, item.id));

      const [fact] = await tx
        .insert(factVersions)
        .values({
          scheduleItemId: item.id,
          studentId: item.studentId,
          factKey: "schedule.completed",
          sourceKind: manualExecution ? "manual" : "system",
          value: {
            completion_kind: completionKind,
            ...(startedAt
              ? {
                  started_at: startedAt.toISOString(),
                  completed_at: completedAt.toISOString(),
                  duration_minutes: Math.round(
                    (completedAt.getTime() - startedAt.getTime()) / 60_000,
                  ),
                }
              : {}),
          },
          idempotencyKey: input.idempotencyKey,
          idempotencyPayloadHash: bodyHash,
          completionKind,
          occurredAt: completedAt,
          assertedAt: now,
          recordedAt: now,
          submittedBy: manualExecution ? input.actorId : null,
        })
        .returning();

      if (!fact) {
        throw new Error("Failed to create fact version");
      }

      const settle = input.settleForFact ?? defaultSettleForFact;
      const settlement = await settle(tx, {
        factVersionId: fact.id,
      });

      await appendAuditEvent(tx, {
        actorId: input.actorId,
        action: "schedule_item.completed",
        resourceType: "schedule_item",
        resourceId: item.id,
        requestId: input.requestId ?? null,
        idempotencyKey: `audit:schedule-completed:${input.idempotencyKey}`,
        metadata: { completionKind, factVersionId: fact.id },
      });

      await appendOutboxEvent(tx, {
        aggregateType: "schedule_item",
        aggregateId: item.id,
        eventType: "schedule.completed",
        dedupeKey: `schedule.completed:${item.id}`,
        payload: {
          scheduleItemId: item.id,
          eventId: event.id,
          factVersionId: fact.id,
          completionKind,
        },
      });

      return {
        scheduleItemId: item.id,
        eventId: event.id,
        factVersionId: fact.id,
        completionKind,
        settlementId: settlement.settlementId,
        ledgerEntryId: settlement.ledgerEntryId,
        idempotentReplay: false,
      };
    });
  } catch (error) {
    if (error instanceof ScheduleError && error.code === "WINDOW_EXPIRED" && expiredStudentId) {
      await db.transaction(async (tx) => {
        await persistExpiredPastWindow(tx, expiredStudentId!, now);
      });
    }
    throw error;
  }
}
