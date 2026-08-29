import { asc, eq, sql } from "drizzle-orm";

import type { Database } from "@/db";
import { pointLedgerEntries } from "@/db/schema";

export const ledgerEntryOrderBy = [
  asc(pointLedgerEntries.createdAt),
  asc(pointLedgerEntries.id),
] as const;

export async function loadOrderedLedgerEntriesForStudent(
  db: Database,
  studentId: string,
): Promise<Array<{ id: string; amount: number; createdAt: Date }>> {
  return db
    .select({
      id: pointLedgerEntries.id,
      amount: pointLedgerEntries.amount,
      createdAt: pointLedgerEntries.createdAt,
    })
    .from(pointLedgerEntries)
    .where(eq(pointLedgerEntries.studentId, studentId))
    .orderBy(...ledgerEntryOrderBy);
}

export async function resolveLastLedgerEntryForStudent(
  db: Database,
  studentId: string,
): Promise<{ id: string; balance: number } | null> {
  const entries = await loadOrderedLedgerEntriesForStudent(db, studentId);
  const lastEntry = entries.at(-1);
  if (!lastEntry) {
    return null;
  }

  const balance = entries.reduce((sum, entry) => sum + entry.amount, 0);
  return { id: lastEntry.id, balance };
}

export function isLedgerEntryAfter(
  candidate: { createdAt: Date; id: string },
  current: { createdAt: Date; id: string } | null,
): boolean {
  if (!current) {
    return true;
  }

  if (candidate.createdAt.getTime() !== current.createdAt.getTime()) {
    return candidate.createdAt.getTime() > current.createdAt.getTime();
  }

  return candidate.id > current.id;
}

export async function nextGlobalAttemptNumber(
  tx: Database,
  outboxEventId: string,
): Promise<number> {
  const rows = await tx.execute(sql`
    SELECT COALESCE(MAX(attempt_number), 0)::int AS max_attempt
    FROM worker_attempts
    WHERE outbox_event_id = ${outboxEventId}::uuid
  `);

  return ((rows[0] as { max_attempt: number } | undefined)?.max_attempt ?? 0) + 1;
}
