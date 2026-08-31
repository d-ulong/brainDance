import { eq, sql } from "drizzle-orm";

import type { Database } from "@/db";
import { pointBalanceProjection, pointRedemptions } from "@/db/schema";
import { RedemptionError } from "@/modules/redemption/errors";

type MonthlyRow = typeof pointRedemptions.$inferSelect;

/**
 * Frozen approve lock order steps 2–3 (design §2 / P1-R04).
 * Call only after the redemption request row is locked (step 1).
 */
export async function lockStudentBalanceThenMonthlyUsage(
  tx: Database,
  input: {
    studentId: string;
    catalogItemId: string;
    requestMonth: string;
    monthlyLimit: number | null;
    lockMonthlyRows: (
      tx: Database,
      catalogItemId: string,
      requestMonth: string,
    ) => Promise<MonthlyRow[]>;
    countMonthlyUsage: (rows: MonthlyRow[]) => Promise<number>;
  },
): Promise<{ balance: number }> {
  await tx.execute(sql`SELECT id FROM users WHERE id = ${input.studentId}::uuid FOR UPDATE`);

  const [balanceRow] = await tx
    .select({ balance: pointBalanceProjection.balance })
    .from(pointBalanceProjection)
    .where(eq(pointBalanceProjection.studentId, input.studentId))
    .limit(1);

  const balance = balanceRow?.balance ?? 0;

  if (input.monthlyLimit != null) {
    const monthlyRows = await input.lockMonthlyRows(tx, input.catalogItemId, input.requestMonth);
    if ((await input.countMonthlyUsage(monthlyRows)) > input.monthlyLimit) {
      throw new RedemptionError("MONTHLY_LIMIT_EXCEEDED", "Monthly redemption limit exceeded");
    }
  }

  return { balance };
}
