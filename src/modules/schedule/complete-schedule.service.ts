import { and, eq, sql } from "drizzle-orm";

import type { Database } from "@/db";
import { factVersions, scheduleEvents, scheduleItems } from "@/db/schema";
import { appendAuditEvent } from "@/modules/audit/append-audit-event";
import { appendOutboxEvent } from "@/modules/outbox/append-outbox-event";
import { hashIdempotencyPayload } from "@/modules/schedule/normalize-idempotency-payload";
import { persistExpiredPastWindow } from "@/modules/schedule/persist-expired.service";
import { ScheduleError } from "@/modules/schedule/errors";
import { deriveCompletionKind } from "@/modules/time-policy/derive-completion-kind";
import { isPastCompletionWindow } from "@/modules/time-policy/completion-window";
import {
  loadSettlementReplayForFact,
  settleForFact as defaultSettleForFact,
  type SettleForFactResult,
} from "@/modules/settlement/settlement.service";

export type SettleForFactInput = {
  factVersionId: string;
  scheduleItemId: string;
  studentId: string;
  idempotencyKey: string;
  completionKind: "on_time" | "late";
  familyDate: string;
};

/** Phase 4 settlement seam — invoked in the same transaction as fact creation. */
export type SettleForFactFn = (
  tx: Database,
  input: SettleForFactInput,
) => Promise<SettleForFactResult>;

export type CompleteScheduleInput = {
  actorId: string;
  scheduleItemId: string;
  idempotencyKey: string;
  body?: Record<string, unknown>;
  now?: Date;
  requestId?: string;
  settleForFact?: SettleForFactFn;
};

export type CompleteScheduleResult = {
  scheduleItemId: string;
  eventId: string;
  factVersionId: string;
  completionKind: "on_time" | "late";
  settlementId?: string;
  ledgerEntryId?: string;
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

  const settlement = await loadSettlementReplayForFact(tx, fact.id);

  return {
    scheduleItemId,
    eventId: event.id,
    factVersionId: fact.id,
    completionKind: event.completionKind as "on_time" | "late",
    settlementId: settlement?.settlementId,
    ledgerEntryId: settlement?.ledgerEntryId,
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

  if (preflightItem.studentId !== input.actorId) {
    throw new ScheduleError("FORBIDDEN", "Only the student can complete schedule items");
  }

  let expiredStudentId: string | null = null;

  try {
    return await db.transaction(async (tx) => {
      const item = await lockScheduleItem(tx, input.scheduleItemId);

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

      if (isPastCompletionWindow(item.familyDate, now)) {
        expiredStudentId = item.studentId;
        throw new ScheduleError("WINDOW_EXPIRED", "Completion window has expired");
      }

      const completionKind = deriveCompletionKind(now, item.familyDate);

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
          occurredAt: now,
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
          sourceKind: "system",
          value: { completion_kind: completionKind },
          idempotencyKey: input.idempotencyKey,
          idempotencyPayloadHash: bodyHash,
          completionKind,
          occurredAt: now,
          assertedAt: now,
          recordedAt: now,
        })
        .returning();

      if (!fact) {
        throw new Error("Failed to create fact version");
      }

      const settle = input.settleForFact ?? defaultSettleForFact;
      const settlement = await settle(tx, {
        factVersionId: fact.id,
        scheduleItemId: item.id,
        studentId: item.studentId,
        idempotencyKey: input.idempotencyKey,
        completionKind,
        familyDate: item.familyDate,
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
