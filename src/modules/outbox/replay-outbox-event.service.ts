import { eq, sql } from "drizzle-orm";

import type { Database } from "@/db";
import { outboxEvents, workerAttempts } from "@/db/schema";
import { appendAuditEvent } from "@/modules/audit/append-audit-event";
import { OutboxError } from "@/modules/outbox/errors";
import { nextGlobalAttemptNumber } from "@/modules/settlement/ledger-order";

export type DeadOutboxEventDto = {
  id: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  eventVersion: number;
  attempts: number;
  lastErrorCode: string | null;
  createdAt: Date;
};

export async function listDeadOutboxEvents(
  db: Database,
  input: { limit?: number; offset?: number },
): Promise<{ events: DeadOutboxEventDto[]; total: number }> {
  const limit = Math.min(input.limit ?? 50, 100);
  const offset = input.offset ?? 0;

  const [countRow] = await db.execute(sql`
    SELECT count(*)::int AS count FROM outbox_events WHERE status = 'dead'
  `);

  const rows = await db
    .select({
      id: outboxEvents.id,
      aggregateType: outboxEvents.aggregateType,
      aggregateId: outboxEvents.aggregateId,
      eventType: outboxEvents.eventType,
      eventVersion: outboxEvents.eventVersion,
      attempts: outboxEvents.attempts,
      lastErrorCode: outboxEvents.lastErrorCode,
      createdAt: outboxEvents.createdAt,
    })
    .from(outboxEvents)
    .where(eq(outboxEvents.status, "dead"))
    .orderBy(sql`${outboxEvents.createdAt} DESC`)
    .limit(limit)
    .offset(offset);

  return {
    events: rows,
    total: (countRow as { count: number }).count,
  };
}

export type ReplayOutboxEventInput = {
  eventId: string;
  actorId: string;
  reason: string;
  idempotencyKey: string;
  now?: Date;
};

export type ReplayOutboxEventResult = {
  eventId: string;
  idempotentReplay: boolean;
};

export async function replayDeadOutboxEvent(
  db: Database,
  input: ReplayOutboxEventInput,
): Promise<ReplayOutboxEventResult> {
  const now = input.now ?? new Date();

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT id FROM outbox_events WHERE id = ${input.eventId}::uuid FOR UPDATE`,
    );

    const [priorReplay] = await tx
      .select({ id: workerAttempts.id })
      .from(workerAttempts)
      .where(
        sql`${workerAttempts.outboxEventId} = ${input.eventId}::uuid
            AND ${workerAttempts.outcome} = 'replayed'
            AND ${workerAttempts.replayIdempotencyKey} = ${input.idempotencyKey}`,
      )
      .limit(1);

    if (priorReplay) {
      return { eventId: input.eventId, idempotentReplay: true };
    }

    const [event] = await tx
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.id, input.eventId))
      .limit(1);

    if (!event) {
      throw new OutboxError("NOT_FOUND", "Outbox event not found");
    }

    if (event.status !== "dead") {
      throw new OutboxError("STATE_CONFLICT", "Only dead events can be replayed");
    }

    const replayAttemptNumber = await nextGlobalAttemptNumber(tx, input.eventId);

    await tx.insert(workerAttempts).values({
      outboxEventId: input.eventId,
      attemptNumber: replayAttemptNumber,
      outcome: "replayed",
      startedAt: now,
      finishedAt: now,
      replayActorId: input.actorId,
      replayReason: input.reason,
      replayIdempotencyKey: input.idempotencyKey,
    });

    await appendAuditEvent(tx, {
      actorId: input.actorId,
      action: "outbox.replayed",
      resourceType: "outbox_event",
      resourceId: input.eventId,
      idempotencyKey: `audit:outbox-replayed:${input.eventId}:${input.idempotencyKey}`,
      metadata: {
        replayReason: input.reason,
        replayIdempotencyKey: input.idempotencyKey,
      },
    });

    await tx
      .update(outboxEvents)
      .set({
        status: "pending",
        availableAt: now,
        attempts: 0,
        leaseToken: null,
        leaseOwner: null,
        leasedUntil: null,
        lastErrorCode: null,
      })
      .where(eq(outboxEvents.id, input.eventId));

    return { eventId: input.eventId, idempotentReplay: false };
  });
}
