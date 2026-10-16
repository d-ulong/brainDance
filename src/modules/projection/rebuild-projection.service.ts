import { eq, sql } from "drizzle-orm";

import type { Database } from "@/db";
import { pointBalanceProjection } from "@/db/schema";
import {
  loadOrderedLedgerEntriesForStudent,
  sumLedgerAmounts,
} from "@/modules/settlement/ledger-order";

import { lockLedgerSubject } from "@/modules/settlement/ledger.service";

export type RebuildProjectionResult = {
  studentsScanned: number;
  studentsRebuilt: number;
  ledgerEntriesScanned: number;
  staleProjectionsRemoved: number;
};

export async function rebuildProjectionForStudent(
  tx: Database,
  studentId: string,
  now: Date = new Date(),
): Promise<{ ledgerEntriesScanned: number; staleProjectionRemoved: number }> {
  await lockLedgerSubject(tx, studentId);
  const entries = await loadOrderedLedgerEntriesForStudent(tx, studentId);
  const last = entries.at(-1);
  const resolved = last ? { id: last.id, balance: sumLedgerAmounts(entries) } : null;

  if (!resolved) {
    const removed = await tx
      .delete(pointBalanceProjection)
      .where(eq(pointBalanceProjection.studentId, studentId))
      .returning({ id: pointBalanceProjection.studentId });
    return { ledgerEntriesScanned: 0, staleProjectionRemoved: removed.length };
  }

  await tx
    .insert(pointBalanceProjection)
    .values({
      studentId,
      balance: resolved.balance,
      lastLedgerEntryId: resolved.id,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: pointBalanceProjection.studentId,
      set: {
        balance: resolved.balance,
        lastLedgerEntryId: resolved.id,
        updatedAt: now,
      },
    });

  return { ledgerEntriesScanned: entries.length, staleProjectionRemoved: 0 };
}

export async function rebuildProjection(
  db: Database,
  options?: { studentId?: string; now?: Date },
): Promise<RebuildProjectionResult> {
  const now = options?.now ?? new Date();

  if (options?.studentId) {
    return db.transaction(async (tx) => {
      const result = await rebuildProjectionForStudent(tx, options.studentId!, now);
      return {
        studentsScanned: 1,
        studentsRebuilt: 1,
        ledgerEntriesScanned: result.ledgerEntriesScanned,
        staleProjectionsRemoved: 0,
      };
    });
  }

  // Include orphan projections, then lock/recheck each subject before deleting anything.
  // A snapshot of ledger IDs followed by global cleanup races concurrent first entries.
  const studentRows = await db.execute(sql`
    SELECT student_id FROM point_ledger_entries
    UNION SELECT student_id FROM point_balance_projection ORDER BY student_id
  `);
  const studentIds = (studentRows as unknown as { student_id: string }[]).map(
    (row) => row.student_id,
  );
  let ledgerEntriesScanned = 0;
  let staleProjectionsRemoved = 0;
  for (const studentId of studentIds) {
    const result = await db.transaction((tx) => rebuildProjectionForStudent(tx, studentId, now));
    ledgerEntriesScanned += result.ledgerEntriesScanned;
    staleProjectionsRemoved += result.staleProjectionRemoved;
  }
  return {
    studentsScanned: studentIds.length,
    studentsRebuilt: studentIds.length,
    ledgerEntriesScanned,
    staleProjectionsRemoved,
  };
}
