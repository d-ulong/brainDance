import { eq, inArray, sql } from "drizzle-orm";

import type { Database } from "@/db";
import { pointBalanceProjection } from "@/db/schema";
import {
  loadOrderedLedgerEntriesForStudent,
  resolveLastLedgerEntryForStudent,
} from "@/modules/settlement/ledger-order";

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
): Promise<{ ledgerEntriesScanned: number }> {
  const entries = await loadOrderedLedgerEntriesForStudent(tx, studentId);
  const resolved = await resolveLastLedgerEntryForStudent(tx, studentId);

  if (!resolved) {
    await tx.delete(pointBalanceProjection).where(eq(pointBalanceProjection.studentId, studentId));
    return { ledgerEntriesScanned: 0 };
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
        staleProjectionsRemoved: 0,
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
  let staleProjectionsRemoved = 0;

  await db.transaction(async (tx) => {
    for (const studentId of studentIds) {
      const result = await rebuildProjectionForStudent(tx, studentId, now);
      ledgerEntriesScanned += result.ledgerEntriesScanned;
    }

    if (studentIds.length === 0) {
      const removed = await tx
        .delete(pointBalanceProjection)
        .returning({ studentId: pointBalanceProjection.studentId });
      staleProjectionsRemoved = removed.length;
      return;
    }

    const staleRows = await tx
      .select({ studentId: pointBalanceProjection.studentId })
      .from(pointBalanceProjection)
      .where(
        sql`${pointBalanceProjection.studentId} NOT IN (${sql.join(
          studentIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`,
      );

    if (staleRows.length > 0) {
      await tx.delete(pointBalanceProjection).where(
        inArray(
          pointBalanceProjection.studentId,
          staleRows.map((row) => row.studentId),
        ),
      );
      staleProjectionsRemoved = staleRows.length;
    }
  });

  return {
    studentsScanned: studentIds.length,
    studentsRebuilt: studentIds.length,
    ledgerEntriesScanned,
    staleProjectionsRemoved,
  };
}
