import { eq } from "drizzle-orm";

import type { Database } from "@/db";
import { outboxEvents } from "@/db/schema";

export type AppendOutboxInput = {
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  eventVersion?: number;
  dedupeKey: string;
  payload: Record<string, unknown>;
  availableAt?: Date;
};

export async function appendOutboxEvent(db: Database, input: AppendOutboxInput): Promise<string> {
  const [existing] = await db
    .select({ id: outboxEvents.id })
    .from(outboxEvents)
    .where(eq(outboxEvents.dedupeKey, input.dedupeKey))
    .limit(1);

  if (existing) {
    return existing.id;
  }

  const [row] = await db
    .insert(outboxEvents)
    .values({
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      eventType: input.eventType,
      eventVersion: input.eventVersion ?? 1,
      dedupeKey: input.dedupeKey,
      payload: input.payload,
      status: "pending",
      ...(input.availableAt ? { availableAt: input.availableAt } : {}),
    })
    .onConflictDoNothing({ target: outboxEvents.dedupeKey })
    .returning({ id: outboxEvents.id });

  if (row) {
    return row.id;
  }

  const [raced] = await db
    .select({ id: outboxEvents.id })
    .from(outboxEvents)
    .where(eq(outboxEvents.dedupeKey, input.dedupeKey))
    .limit(1);

  if (raced) {
    return raced.id;
  }

  throw new Error("Failed to append outbox event");
}

export async function findOutboxEventByDedupeKey(db: Database, dedupeKey: string) {
  const [row] = await db
    .select()
    .from(outboxEvents)
    .where(eq(outboxEvents.dedupeKey, dedupeKey))
    .limit(1);

  return row;
}
