import { and, eq, sql } from "drizzle-orm";

import type { Database } from "@/db";
import { scheduleEvents, scheduleItems } from "@/db/schema";
import { appendAuditEvent } from "@/modules/audit/append-audit-event";
import { requireActiveRelationship } from "@/modules/family-access/authorization.service";
import { FamilyAccessError } from "@/modules/family-access/errors";
import { appendOutboxEvent } from "@/modules/outbox/append-outbox-event";
import { hashIdempotencyPayload } from "@/modules/schedule/normalize-idempotency-payload";
import { persistExpiredPastWindow } from "@/modules/schedule/persist-expired.service";
import { ScheduleError } from "@/modules/schedule/errors";
import { isPastCompletionWindow } from "@/modules/time-policy/completion-window";

export type SkipScheduleInput = {
  actorId: string;
  scheduleItemId: string;
  idempotencyKey: string;
  body?: { reason?: string | null };
  now?: Date;
  requestId?: string;
};

export type SkipScheduleResult = {
  scheduleItemId: string;
  eventId: string;
  reason: string | null;
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

async function assertSkipAuthorization(
  db: Database,
  actorId: string,
  item: LockedItem,
): Promise<void> {
  if (item.studentId === actorId) {
    return;
  }

  try {
    await requireActiveRelationship(db, actorId, item.studentId);
  } catch (error) {
    if (error instanceof FamilyAccessError && error.code === "FORBIDDEN") {
      throw new ScheduleError("FORBIDDEN", error.message);
    }
    throw error;
  }
}

function assertSkipEventReplayMatch(
  existing: typeof scheduleEvents.$inferSelect,
  input: { actorId: string; bodyHash: string },
): void {
  if (
    existing.actorId !== input.actorId ||
    existing.idempotencyPayloadHash !== input.bodyHash ||
    existing.toStatus !== "skipped"
  ) {
    throw new ScheduleError("IDEMPOTENCY_CONFLICT", "Schedule event idempotency conflict");
  }
}

async function loadSkipReplay(
  tx: Database,
  scheduleItemId: string,
  idempotencyKey: string,
): Promise<SkipScheduleResult> {
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

  if (!event || event.toStatus !== "skipped") {
    throw new ScheduleError("STATE_CONFLICT", "Skip replay event missing");
  }

  return {
    scheduleItemId,
    eventId: event.id,
    reason: event.reason,
    idempotentReplay: true,
  };
}

export async function skipScheduleItem(
  db: Database,
  input: SkipScheduleInput,
): Promise<SkipScheduleResult> {
  const now = input.now ?? new Date();
  const body = input.body ?? {};
  const bodyHash = hashIdempotencyPayload(body);
  const reason = body.reason ?? null;

  const [preflightItem] = await db
    .select()
    .from(scheduleItems)
    .where(eq(scheduleItems.id, input.scheduleItemId))
    .limit(1);

  if (!preflightItem) {
    throw new ScheduleError("NOT_FOUND", "Schedule item not found");
  }

  await assertSkipAuthorization(db, input.actorId, preflightItem);

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
        assertSkipEventReplayMatch(existingEvent, {
          actorId: input.actorId,
          bodyHash,
        });
        return loadSkipReplay(tx, input.scheduleItemId, input.idempotencyKey);
      }

      if (item.status !== "pending") {
        throw new ScheduleError("STATE_CONFLICT", "Schedule item is not pending");
      }

      if (isPastCompletionWindow(item.familyDate, now)) {
        expiredStudentId = item.studentId;
        throw new ScheduleError("WINDOW_EXPIRED", "Completion window has expired");
      }

      const [event] = await tx
        .insert(scheduleEvents)
        .values({
          scheduleItemId: item.id,
          actorId: input.actorId,
          fromStatus: "pending",
          toStatus: "skipped",
          idempotencyKey: input.idempotencyKey,
          idempotencyPayloadHash: bodyHash,
          completionKind: null,
          reason,
          occurredAt: now,
        })
        .returning();

      if (!event) {
        throw new Error("Failed to create schedule event");
      }

      await tx
        .update(scheduleItems)
        .set({ status: "skipped" })
        .where(eq(scheduleItems.id, item.id));

      await appendAuditEvent(tx, {
        actorId: input.actorId,
        action: "schedule_item.skipped",
        resourceType: "schedule_item",
        resourceId: item.id,
        requestId: input.requestId ?? null,
        idempotencyKey: `audit:schedule-skipped:${input.idempotencyKey}`,
        metadata: reason ? { reason } : undefined,
      });

      await appendOutboxEvent(tx, {
        aggregateType: "schedule_item",
        aggregateId: item.id,
        eventType: "schedule.skipped",
        dedupeKey: `schedule.skipped:${item.id}`,
        payload: {
          scheduleItemId: item.id,
          eventId: event.id,
          reason,
        },
      });

      return {
        scheduleItemId: item.id,
        eventId: event.id,
        reason: event.reason,
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
