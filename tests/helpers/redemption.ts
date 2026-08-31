import { sql } from "drizzle-orm";

import { pointBalanceProjection } from "@/db/schema";
import { createCatalogItem } from "@/modules/redemption/catalog.service";
import { bootstrapParentStudentRelationship, FIXED_NOW } from "./schedule";

import type { TestDb } from "./db";

export const REDEMPTION_TABLES = ["point_redemptions", "redemption_catalog_items"] as const;

export async function resetRedemptionTables(db: TestDb): Promise<void> {
  await db.execute(sql`
    TRUNCATE TABLE
      ${sql.raw(REDEMPTION_TABLES.join(", "))}
    RESTART IDENTITY CASCADE
  `);
}

export async function seedStudentBalance(
  db: TestDb,
  studentId: string,
  balance: number,
  now: Date = FIXED_NOW,
): Promise<void> {
  await db
    .insert(pointBalanceProjection)
    .values({
      studentId,
      balance,
      lastLedgerEntryId: null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: pointBalanceProjection.studentId,
      set: {
        balance,
        updatedAt: now,
      },
    });
}

export async function bootstrapCatalogItem(
  db: TestDb,
  input: {
    parentId: string;
    studentId: string;
    cost?: number;
    monthlyLimit?: number | null;
    title?: string;
    idempotencyKey?: string;
  },
) {
  return createCatalogItem(db, {
    parentId: input.parentId,
    studentId: input.studentId,
    idempotencyKey: input.idempotencyKey ?? `catalog-${crypto.randomUUID()}`,
    body: {
      title: input.title ?? "Test Reward",
      cost: input.cost ?? 10,
      monthlyLimit: input.monthlyLimit ?? null,
    },
    now: FIXED_NOW,
  });
}

export async function bootstrapRedemptionFixture(db: TestDb) {
  const { parentId, studentId } = await bootstrapParentStudentRelationship(db);
  await seedStudentBalance(db, studentId, 100);
  const { item } = await bootstrapCatalogItem(db, { parentId, studentId });
  return { parentId, studentId, catalogItemId: item.id };
}
