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

/**
 * Seed a positive balance that survives `rebuildProjectionForStudent`.
 * Projection-only seeds (see `seedStudentBalance`) diverge after `points.settled`
 * outbox rebuild because they have no ledger rows.
 */
export async function seedRebuildSafeStudentBalance(
  db: TestDb,
  input: {
    parentId: string;
    studentId: string;
    balance: number;
    now?: Date;
  },
): Promise<{ ledgerEntryId: string }> {
  if (!Number.isInteger(input.balance) || input.balance <= 0) {
    throw new Error("seedRebuildSafeStudentBalance requires a positive integer balance");
  }

  const now = input.now ?? FIXED_NOW;
  const ts = now.toISOString();
  const key = crypto.randomUUID().slice(0, 8);

  const planRows = await db.execute(sql`
    INSERT INTO plans (
      student_id, owner_id, plan_kind, status, title, start_date,
      create_idempotency_key, create_idempotency_payload_hash
    ) VALUES (
      ${input.studentId}::uuid, ${input.parentId}::uuid, 'formal', 'inactive',
      'E2E Seed Plan', '2026-01-01',
      ${`seed-plan-${key}`}, ${`hash-seed-plan-${key}`}
    )
    RETURNING id
  `);
  const planId = (planRows[0] as { id: string }).id;

  const versionRows = await db.execute(sql`
    INSERT INTO plan_versions (
      plan_id, version, schedule_rule, effective_from, created_at,
      create_idempotency_key, create_idempotency_payload_hash
    ) VALUES (
      ${planId}::uuid, 1, '{"frequency":"daily"}'::jsonb, '2026-01-01', ${ts}::timestamptz,
      ${`seed-plan-v1-${key}`}, ${`hash-seed-plan-v1-${key}`}
    )
    RETURNING id
  `);
  const planVersionId = (versionRows[0] as { id: string }).id;

  await db.execute(sql`
    UPDATE plans SET current_version = ${planVersionId}::uuid WHERE id = ${planId}::uuid
  `);

  const itemRows = await db.execute(sql`
    INSERT INTO schedule_items (
      plan_id, plan_version_id, student_id, owner_id, family_date, slot_key,
      scheduled_at, status, source, occurrence_key
    ) VALUES (
      ${planId}::uuid, ${planVersionId}::uuid, ${input.studentId}::uuid, ${input.parentId}::uuid,
      '2026-01-01', 'default', ${ts}::timestamptz, 'completed', 'plan',
      ${`seed-occ-${key}`}
    )
    RETURNING id
  `);
  const scheduleItemId = (itemRows[0] as { id: string }).id;

  const factRows = await db.execute(sql`
    INSERT INTO fact_versions (
      schedule_item_id, student_id, fact_key, source_kind, value,
      idempotency_key, idempotency_payload_hash, completion_kind,
      occurred_at, asserted_at, recorded_at
    ) VALUES (
      ${scheduleItemId}::uuid, ${input.studentId}::uuid, 'schedule.completed', 'system',
      '{"completion_kind":"on_time"}'::jsonb, ${`seed-fact-${key}`}, ${`hash-seed-fact-${key}`},
      'on_time', ${ts}::timestamptz, ${ts}::timestamptz, ${ts}::timestamptz
    )
    RETURNING id
  `);
  const factVersionId = (factRows[0] as { id: string }).id;

  const ruleRows = await db.execute(sql`
    INSERT INTO point_rules (
      student_id, creator_parent_id, template_id, active,
      create_idempotency_key, create_idempotency_payload_hash, created_at
    ) VALUES (
      ${input.studentId}::uuid, ${input.parentId}::uuid, 'schedule_system_complete_v1', false,
      ${`seed-rule-${key}`}, ${`hash-seed-rule-${key}`}, ${ts}::timestamptz
    )
    RETURNING id
  `);
  const pointRuleId = (ruleRows[0] as { id: string }).id;

  const ruleVersionRows = await db.execute(sql`
    INSERT INTO point_rule_versions (
      point_rule_id, version, parameters, effect, priority, effective_at, status
    ) VALUES (
      ${pointRuleId}::uuid, 1, '{}'::jsonb, ${JSON.stringify({ amount: input.balance })}::jsonb,
      NULL, ${ts}::timestamptz, 'active'
    )
    RETURNING id
  `);
  const ruleVersionId = (ruleVersionRows[0] as { id: string }).id;

  const settlementRows = await db.execute(sql`
    INSERT INTO settlements (
      student_id, fact_version_id, rule_version_id, settlement_period,
      result, explanation, idempotency_key
    ) VALUES (
      ${input.studentId}::uuid, ${factVersionId}::uuid, ${ruleVersionId}::uuid, '2026-01-01',
      'reward', ${`E2E rebuild-safe seed +${input.balance}`}, ${`seed-settlement-${key}`}
    )
    RETURNING id
  `);
  const settlementId = (settlementRows[0] as { id: string }).id;

  const ledgerRows = await db.execute(sql`
    INSERT INTO point_ledger_entries (
      student_id, settlement_id, amount, reason, source_type, explanation, source_id,
      reverses_entry_id, created_by, idempotency_key, created_at
    ) VALUES (
      ${input.studentId}::uuid, ${settlementId}::uuid, ${input.balance}, 'schedule_complete',
      'settlement', ${`E2E rebuild-safe seed +${input.balance}`}, ${settlementId}::uuid,
      NULL, NULL, ${`seed-ledger-${key}`}, ${ts}::timestamptz
    )
    RETURNING id
  `);
  const ledgerEntryId = (ledgerRows[0] as { id: string }).id;

  await db
    .insert(pointBalanceProjection)
    .values({
      studentId: input.studentId,
      balance: input.balance,
      lastLedgerEntryId: ledgerEntryId,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: pointBalanceProjection.studentId,
      set: {
        balance: input.balance,
        lastLedgerEntryId: ledgerEntryId,
        updatedAt: now,
      },
    });

  return { ledgerEntryId };
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
