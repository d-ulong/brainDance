import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import type { Database } from "@/db";
import { outboxEvents, workerAttempts } from "@/db/schema";
import { getM6EventHandler } from "@/modules/data-lifecycle/m6-outbox-handlers";
import { OutboxError } from "@/modules/outbox/errors";
import { getM3EventHandler } from "@/modules/outbox/m3-event-handlers";
import {
  computeBackoffMs,
  isSupportedNoopEvent,
  OUTBOX_LEASE_DURATION_MS,
  OUTBOX_MAX_ATTEMPTS,
} from "@/modules/outbox/worker-constants";
import { logWorkerEvent } from "@/modules/outbox/worker-logger";
import { nextGlobalAttemptNumber } from "@/modules/settlement/ledger-order";

export type ClaimedOutboxEvent = {
  eventId: string;
  eventType: string;
  eventVersion: number;
  payload: Record<string, unknown>;
  leaseToken: string;
  attemptNumber: number;
  aggregateType: string;
  aggregateId: string;
};

export type ClaimOutboxEventInput = {
  workerId: string;
  now?: Date;
};

export async function claimNextOutboxEvent(
  db: Database,
  input: ClaimOutboxEventInput,
): Promise<ClaimedOutboxEvent | null> {
  const now = input.now ?? new Date();

  return db.transaction(async (tx) => {
    const rows = input.now
      ? await tx.execute(sql`
          SELECT id, event_type, event_version, payload, attempts, aggregate_type, aggregate_id
          FROM outbox_events
          WHERE (
            (status = 'pending' AND available_at <= ${now.toISOString()}::timestamptz)
            OR (status = 'leased' AND leased_until <= ${now.toISOString()}::timestamptz)
          )
          ORDER BY available_at
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        `)
      : await tx.execute(sql`
          SELECT id, event_type, event_version, payload, attempts, aggregate_type, aggregate_id
          FROM outbox_events
          WHERE (
            (status = 'pending' AND available_at <= now())
            OR (status = 'leased' AND leased_until <= now())
          )
          ORDER BY available_at
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        `);

    if (rows.length === 0) {
      return null;
    }

    const row = rows[0] as {
      id: string;
      event_type: string;
      event_version: number;
      payload: Record<string, unknown>;
      attempts: number;
      aggregate_type: string;
      aggregate_id: string;
    };

    const attemptNumber = await nextGlobalAttemptNumber(tx, row.id);
    const retryCycleAttempt = row.attempts + 1;
    const leaseToken = randomUUID();
    const leasedUntil = new Date(now.getTime() + OUTBOX_LEASE_DURATION_MS);

    await tx
      .update(outboxEvents)
      .set({
        status: "leased",
        leaseToken,
        leaseOwner: input.workerId,
        leasedUntil,
        attempts: retryCycleAttempt,
      })
      .where(sql`${outboxEvents.id} = ${row.id}::uuid`);

    await tx.insert(workerAttempts).values({
      outboxEventId: row.id,
      attemptNumber,
      outcome: "leased",
      startedAt: now,
      finishedAt: null,
      leaseToken,
    });

    logWorkerEvent({
      eventId: row.id,
      eventType: row.event_type,
      eventVersion: row.event_version,
      attemptNumber,
      aggregateType: row.aggregate_type,
      aggregateId: row.aggregate_id,
      outcome: "claimed",
    });

    return {
      eventId: row.id,
      eventType: row.event_type,
      eventVersion: row.event_version,
      payload: row.payload,
      leaseToken,
      attemptNumber,
      aggregateType: row.aggregate_type,
      aggregateId: row.aggregate_id,
    };
  });
}

export type CompleteOutboxEventInput = {
  eventId: string;
  leaseToken: string;
  attemptNumber: number;
  workerId: string;
  now?: Date;
};

export async function completeOutboxEvent(
  db: Database,
  input: CompleteOutboxEventInput,
): Promise<void> {
  const now = input.now ?? new Date();

  await db.transaction(async (tx) => {
    const rows = await tx.execute(sql`
      SELECT id, status, lease_token, event_type, event_version, attempts, aggregate_type, aggregate_id
      FROM outbox_events WHERE id = ${input.eventId}::uuid FOR UPDATE
    `);

    if (rows.length === 0) {
      throw new OutboxError("NOT_FOUND", "Outbox event not found");
    }

    const row = rows[0] as {
      id: string;
      status: string;
      lease_token: string;
      event_type: string;
      event_version: number;
      attempts: number;
      aggregate_type: string;
      aggregate_id: string;
    };

    if (row.status !== "leased" || row.lease_token !== input.leaseToken) {
      logWorkerEvent({
        eventId: input.eventId,
        eventType: row.event_type,
        eventVersion: row.event_version,
        attemptNumber: input.attemptNumber,
        outcome: "lease_mismatch",
      });
      throw new OutboxError("LEASE_MISMATCH", "Lease token mismatch");
    }

    await tx
      .update(outboxEvents)
      .set({
        status: "processed",
        leaseToken: null,
        leaseOwner: null,
        leasedUntil: null,
        lastErrorCode: null,
      })
      .where(sql`${outboxEvents.id} = ${input.eventId}::uuid`);

    await tx
      .update(workerAttempts)
      .set({ outcome: "success", finishedAt: now })
      .where(
        sql`${workerAttempts.outboxEventId} = ${input.eventId}::uuid AND ${workerAttempts.attemptNumber} = ${input.attemptNumber}`,
      );

    logWorkerEvent({
      eventId: input.eventId,
      eventType: row.event_type,
      eventVersion: row.event_version,
      attemptNumber: input.attemptNumber,
      aggregateType: row.aggregate_type,
      aggregateId: row.aggregate_id,
      outcome: "success",
    });
  });
}

export type FailOutboxEventInput = {
  eventId: string;
  leaseToken: string;
  attemptNumber: number;
  errorCategory: string;
  workerId: string;
  now?: Date;
};

export async function failOutboxEvent(db: Database, input: FailOutboxEventInput): Promise<void> {
  const now = input.now ?? new Date();

  await db.transaction(async (tx) => {
    const rows = await tx.execute(sql`
      SELECT id, status, lease_token, event_type, event_version, attempts, aggregate_type, aggregate_id
      FROM outbox_events WHERE id = ${input.eventId}::uuid FOR UPDATE
    `);

    if (rows.length === 0) {
      throw new OutboxError("NOT_FOUND", "Outbox event not found");
    }

    const row = rows[0] as {
      id: string;
      status: string;
      lease_token: string;
      event_type: string;
      event_version: number;
      attempts: number;
      aggregate_type: string;
      aggregate_id: string;
    };

    if (row.status !== "leased" || row.lease_token !== input.leaseToken) {
      throw new OutboxError("LEASE_MISMATCH", "Lease token mismatch");
    }

    await tx
      .update(workerAttempts)
      .set({ outcome: "failure", finishedAt: now, errorCategory: input.errorCategory })
      .where(
        sql`${workerAttempts.outboxEventId} = ${input.eventId}::uuid AND ${workerAttempts.attemptNumber} = ${input.attemptNumber}`,
      );

    if (row.attempts >= OUTBOX_MAX_ATTEMPTS) {
      await tx
        .update(outboxEvents)
        .set({
          status: "dead",
          leaseToken: null,
          leaseOwner: null,
          leasedUntil: null,
          lastErrorCode: input.errorCategory,
        })
        .where(sql`${outboxEvents.id} = ${input.eventId}::uuid`);

      logWorkerEvent({
        eventId: input.eventId,
        eventType: row.event_type,
        eventVersion: row.event_version,
        attemptNumber: input.attemptNumber,
        errorCategory: input.errorCategory,
        aggregateType: row.aggregate_type,
        aggregateId: row.aggregate_id,
        outcome: "dead",
      });
      return;
    }

    const backoffMs = computeBackoffMs(row.attempts);
    const availableAt = new Date(now.getTime() + backoffMs);

    await tx
      .update(outboxEvents)
      .set({
        status: "pending",
        availableAt,
        leaseToken: null,
        leaseOwner: null,
        leasedUntil: null,
        lastErrorCode: input.errorCategory,
      })
      .where(sql`${outboxEvents.id} = ${input.eventId}::uuid`);

    logWorkerEvent({
      eventId: input.eventId,
      eventType: row.event_type,
      eventVersion: row.event_version,
      attemptNumber: input.attemptNumber,
      errorCategory: input.errorCategory,
      aggregateType: row.aggregate_type,
      aggregateId: row.aggregate_id,
      outcome: "failure",
    });
  });
}

export type ProcessOutboxEventResult = {
  processed: boolean;
  noOp: boolean;
};

export async function processNextOutboxEvent(
  db: Database,
  input: { workerId: string; now?: Date },
): Promise<ProcessOutboxEventResult> {
  const claimed = await claimNextOutboxEvent(db, input);
  if (claimed) {
    const handler =
      getM3EventHandler(claimed.eventType, claimed.eventVersion) ??
      getM6EventHandler(claimed.eventType, claimed.eventVersion);
    if (handler) {
      try {
        await handler(db, claimed);
        await completeOutboxEvent(db, {
          eventId: claimed.eventId,
          leaseToken: claimed.leaseToken,
          attemptNumber: claimed.attemptNumber,
          workerId: input.workerId,
          now: input.now,
        });
        return { processed: true, noOp: false };
      } catch {
        await failOutboxEvent(db, {
          eventId: claimed.eventId,
          leaseToken: claimed.leaseToken,
          attemptNumber: claimed.attemptNumber,
          errorCategory: "handler_failure",
          workerId: input.workerId,
          now: input.now,
        }).catch((failError) => {
          if (failError instanceof OutboxError && failError.code === "LEASE_MISMATCH") {
            return;
          }
          throw failError;
        });
        return { processed: true, noOp: false };
      }
    }
  }

  if (!claimed) {
    return { processed: false, noOp: false };
  }

  if (isSupportedNoopEvent(claimed.eventType, claimed.eventVersion)) {
    await completeOutboxEvent(db, {
      eventId: claimed.eventId,
      leaseToken: claimed.leaseToken,
      attemptNumber: claimed.attemptNumber,
      workerId: input.workerId,
      now: input.now,
    });
    return { processed: true, noOp: true };
  }

  try {
    await failOutboxEvent(db, {
      eventId: claimed.eventId,
      leaseToken: claimed.leaseToken,
      attemptNumber: claimed.attemptNumber,
      errorCategory: "unsupported_event",
      workerId: input.workerId,
      now: input.now,
    });
  } catch (error) {
    if (error instanceof OutboxError && error.code === "LEASE_MISMATCH") {
      return { processed: false, noOp: false };
    }
    throw error;
  }

  return { processed: true, noOp: false };
}
