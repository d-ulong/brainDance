import { asc, eq, sql } from "drizzle-orm";

import type { Database } from "@/db";
import { pointBalanceProjection, pointLedgerEntries } from "@/db/schema";

export type RebuildProjectionResult = {
  studentsScanned: number;
  studentsRebuilt: number;
  ledgerEntriesScanned: number;
};

export async function rebuildProjectionForStudent(
  tx: Database,
  studentId: string,
  now: Date = new Date(),
): Promise<{ ledgerEntriesScanned: number }> {
  const entries = await tx
    .select({
      id: pointLedgerEntries.id,
      amount: pointLedgerEntries.amount,
    })
    .from(pointLedgerEntries)
    .where(eq(pointLedgerEntries.studentId, studentId))
    .orderBy(asc(pointLedgerEntries.id));

  const balance = entries.reduce((sum, entry) => sum + entry.amount, 0);
  const lastEntry = entries.at(-1);

  await tx
    .insert(pointBalanceProjection)
    .values({
      studentId,
      balance,
      lastLedgerEntryId: lastEntry?.id ?? null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: pointBalanceProjection.studentId,
      set: {
        balance,
        lastLedgerEntryId: lastEntry?.id ?? null,
        updatedAt: now,
      },
    });

  return { ledgerEntriesScanned: entries.length };
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
      };
    });
  }

  const studentRows = await db.execute(sql`
    SELECT DISTINCT student_id FROM point_ledger_entries ORDER BY student_id
  `);

  const studentIds = (studentRows as unknown as { student_id: string }[]).map(
    (row) => row.student_id,
  );

  let ledgerEntriesScanned = 0;

  await db.transaction(async (tx) => {
    for (const studentId of studentIds) {
      const result = await rebuildProjectionForStudent(tx, studentId, now);
      ledgerEntriesScanned += result.ledgerEntriesScanned;
    }
  });

  return {
    studentsScanned: studentIds.length,
    studentsRebuilt: studentIds.length,
    ledgerEntriesScanned,
  };
}
