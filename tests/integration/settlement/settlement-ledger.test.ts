import { config } from "dotenv";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import * as schema from "@/db/schema";
import {
  auditEvents,
  factVersions,
  outboxEvents,
  pointBalanceProjection,
  pointLedgerEntries,
  pointRuleVersions,
  pointRules,
  scheduleEvents,
  scheduleItems,
  settlements,
} from "@/db/schema";
import { completeScheduleItem } from "@/modules/schedule/complete-schedule.service";
import { skipScheduleItem } from "@/modules/schedule/skip-schedule.service";
import { createFormalPlan } from "@/modules/schedule/plan.service";
import { ScheduleError } from "@/modules/schedule/errors";
import { appendLedgerForSettlement } from "@/modules/settlement/ledger.service";
import { enablePointRule } from "@/modules/settlement/point-rule.service";
import { settleForFact } from "@/modules/settlement/settlement.service";
import { SettlementError } from "@/modules/settlement/errors";
import { requireDatabaseUrl } from "@/lib/env";
import {
  bootstrapParentStudentRelationship,
  DEFAULT_PLAN_BODY,
  enableSchedulePointRule,
  FIXED_NOW,
  resetScheduleTables,
} from "../../helpers/schedule";
import {
  closeTestDb,
  getTestDb,
  migrateTestDb,
  resetIdentityTables,
  type TestDb,
} from "../../helpers/db";
import { seedStudentUser } from "../../helpers/family-access";
import { createInvitation } from "@/modules/identity/invitation.service";
import { bootstrapAdmin } from "../../helpers/identity";

config({ path: ".env.local" });
config({ path: ".env" });

const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);
const TEST_SENTINEL = "TEST_SENTINEL_ROLLBACK";

function quotePgIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

type ForeignKeyQuadruple = {
  sourceTable: string;
  sourceColumn: string;
  targetTable: string;
  targetColumn: string;
};

type ForeignKeyIdentity = ForeignKeyQuadruple & {
  constraintName: string;
  constraintDef: string;
  convalidated: boolean;
};

async function findForeignKeyConstraint(
  db: TestDb,
  quadruple: ForeignKeyQuadruple,
): Promise<ForeignKeyIdentity> {
  const rows = await db.execute(sql`
    SELECT
      c.conname AS constraint_name,
      c.convalidated AS convalidated,
      pg_get_constraintdef(c.oid) AS constraint_def
    FROM pg_constraint c
    JOIN pg_class src ON c.conrelid = src.oid
    JOIN pg_namespace src_ns ON src.relnamespace = src_ns.oid
    JOIN pg_class tgt ON c.confrelid = tgt.oid
    JOIN pg_namespace tgt_ns ON tgt.relnamespace = tgt_ns.oid
    JOIN pg_attribute src_a ON src_a.attrelid = src.oid AND src_a.attnum = c.conkey[1]
    JOIN pg_attribute tgt_a ON tgt_a.attrelid = tgt.oid AND tgt_a.attnum = c.confkey[1]
    WHERE c.contype = 'f'
      AND array_length(c.conkey, 1) = 1
      AND array_length(c.confkey, 1) = 1
      AND src_ns.nspname = 'public'
      AND src.relname = ${quadruple.sourceTable}
      AND src_a.attname = ${quadruple.sourceColumn}
      AND tgt_ns.nspname = 'public'
      AND tgt.relname = ${quadruple.targetTable}
      AND tgt_a.attname = ${quadruple.targetColumn}
  `);

  if (rows.length !== 1) {
    throw new Error(
      `Expected exactly one foreign key for ${quadruple.sourceTable}.${quadruple.sourceColumn} → ${quadruple.targetTable}.${quadruple.targetColumn}, found ${rows.length}`,
    );
  }

  const row = rows[0] as {
    constraint_name: string;
    convalidated: boolean;
    constraint_def: string;
  };

  return {
    ...quadruple,
    constraintName: row.constraint_name,
    constraintDef: row.constraint_def,
    convalidated: row.convalidated,
  };
}

async function assertForeignKeyExists(db: TestDb, beforeDrop: ForeignKeyIdentity): Promise<void> {
  const restored = await findForeignKeyConstraint(db, {
    sourceTable: beforeDrop.sourceTable,
    sourceColumn: beforeDrop.sourceColumn,
    targetTable: beforeDrop.targetTable,
    targetColumn: beforeDrop.targetColumn,
  });

  expect(restored.constraintName).toBe(beforeDrop.constraintName);
  expect(restored.convalidated).toBe(true);
  expect(restored.constraintDef).toBe(beforeDrop.constraintDef);
}

async function dropForeignKey(
  tx: TestDb,
  tableName: string,
  constraintName: string,
): Promise<void> {
  await tx.execute(
    sql.raw(
      `ALTER TABLE ${quotePgIdent(tableName)} DROP CONSTRAINT ${quotePgIdent(constraintName)}`,
    ),
  );
}

async function rollbackAfter(
  db: TestDb,
  fn: (tx: Parameters<Parameters<TestDb["transaction"]>[0]>[0]) => Promise<void>,
): Promise<void> {
  await expect(
    db.transaction(async (tx) => {
      await fn(tx);
      throw new Error(TEST_SENTINEL);
    }),
  ).rejects.toThrow(TEST_SENTINEL);
}

function createGate<T>() {
  let open!: (value: T) => void;
  let release!: () => void;
  const opened = new Promise<T>((resolve) => {
    open = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { opened, released, open, release };
}

function createConcurrentBarrier(participants: number) {
  const ready = createGate<void>();
  const proceed = createGate<void>();
  let arrived = 0;

  return {
    async wait(): Promise<void> {
      arrived += 1;
      if (arrived === participants) {
        ready.open(undefined);
      }
      await proceed.released;
    },
    waitAllReady(): Promise<void> {
      return ready.opened;
    },
    release(): void {
      proceed.release();
    },
  };
}

async function withIndependentTransaction<T>(
  fn: (tx: Parameters<Parameters<TestDb["transaction"]>[0]>[0]) => Promise<T>,
): Promise<T> {
  const client = postgres(requireDatabaseUrl(), { max: 1 });
  const independentDb = drizzle(client, { schema });
  try {
    return await independentDb.transaction(fn);
  } finally {
    await client.end({ timeout: 5 });
  }
}

async function captureSettlementState(db: TestDb, studentId: string) {
  const [balance] = await db
    .select()
    .from(pointBalanceProjection)
    .where(eq(pointBalanceProjection.studentId, studentId));

  return {
    events: await db.select().from(scheduleEvents),
    facts: await db.select().from(factVersions),
    settlements: await db.select().from(settlements),
    ledgers: await db.select().from(pointLedgerEntries),
    balance: balance ?? null,
    ledgerAudits: await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "point_ledger.created")),
    settledOutbox: await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.eventType, "points.settled")),
  };
}

describe.skipIf(!hasDb)("settlement ledger", () => {
  const db = getTestDb();

  beforeAll(async () => {
    await migrateTestDb();
  });

  beforeEach(async () => {
    await resetIdentityTables(db);
    await resetScheduleTables(db);
  });

  afterAll(async () => {
    await closeTestDb();
  });

  async function seedPlanWithRule(options?: { startDate?: string; extraItems?: boolean }) {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);

    const created = await createFormalPlan(db, {
      ownerId: parentId,
      studentId,
      idempotencyKey: `create-settlement-${crypto.randomUUID()}`,
      body: { ...DEFAULT_PLAN_BODY, startDate: options?.startDate ?? "2026-01-15" },
      now: FIXED_NOW,
    });

    await enableSchedulePointRule(db, { parentId, studentId });

    const items = await db
      .select()
      .from(scheduleItems)
      .where(eq(scheduleItems.planId, created.planId))
      .orderBy(scheduleItems.familyDate);

    return { parentId, studentId, created, items };
  }

  it("awards on_time +10 with completion_kind in explanation (AC-M2-4/F4)", async () => {
    const { studentId, items } = await seedPlanWithRule();
    const item = items.find((row) => row.familyDate === "2026-01-15");
    if (!item) throw new Error("Expected item");

    await completeScheduleItem(db, {
      actorId: studentId,
      scheduleItemId: item.id,
      idempotencyKey: "settle-on-time",
      now: FIXED_NOW,
    });

    const [ledger] = await db.select().from(pointLedgerEntries);
    expect(ledger?.amount).toBe(10);
    expect(ledger?.explanation).toContain("completion_kind=on_time");
    expect(ledger?.reason).toBe("schedule_complete");
    expect(ledger?.sourceType).toBe("settlement");
  });

  it("awards late +10 with completion_kind in explanation (AC-M2-5/F15)", async () => {
    const { parentId, studentId, created } = await seedPlanWithRule();

    await db.execute(`
      INSERT INTO schedule_items (
        plan_id, plan_version_id, student_id, owner_id, family_date, slot_key,
        scheduled_at, status, source, occurrence_key
      ) VALUES (
        '${created.planId}', '${created.versionId}', '${studentId}', '${parentId}',
        '2026-01-14', 'default', '2026-01-14T12:00:00Z', 'pending', 'plan', 'manual-late-settlement'
      )
    `);

    const [item] = await db
      .select()
      .from(scheduleItems)
      .where(eq(scheduleItems.occurrenceKey, "manual-late-settlement"))
      .limit(1);

    await completeScheduleItem(db, {
      actorId: studentId,
      scheduleItemId: item!.id,
      idempotencyKey: "settle-late",
      now: new Date("2026-01-15T08:00:00.000Z"),
    });

    const [ledger] = await db.select().from(pointLedgerEntries);
    expect(ledger?.amount).toBe(10);
    expect(ledger?.explanation).toContain("completion_kind=late");
  });

  it("updates balance 0→10 and last_ledger_entry_id on first ledger (C9)", async () => {
    const { studentId, items } = await seedPlanWithRule();
    const item = items.find((row) => row.familyDate === "2026-01-15");
    if (!item) throw new Error("Expected item");

    const result = await completeScheduleItem(db, {
      actorId: studentId,
      scheduleItemId: item.id,
      idempotencyKey: "settle-balance",
      now: FIXED_NOW,
    });

    const [balance] = await db
      .select()
      .from(pointBalanceProjection)
      .where(eq(pointBalanceProjection.studentId, studentId));

    expect(balance?.balance).toBe(10);
    expect(balance?.lastLedgerEntryId).toBe(result.ledgerEntryId);
  });

  it("derives settlement and ledger fields from fact and schedule item rows (P4-R01)", async () => {
    const { studentId, items } = await seedPlanWithRule();
    const item = items.find((row) => row.familyDate === "2026-01-15");
    if (!item) throw new Error("Expected item");

    await completeScheduleItem(db, {
      actorId: studentId,
      scheduleItemId: item.id,
      idempotencyKey: "settle-authoritative",
      now: FIXED_NOW,
    });

    const [fact] = await db
      .select()
      .from(factVersions)
      .where(eq(factVersions.scheduleItemId, item.id));
    const [settlement] = await db.select().from(settlements);
    const [ledger] = await db.select().from(pointLedgerEntries);

    expect(fact).toBeTruthy();
    expect(settlement?.studentId).toBe(fact!.studentId);
    expect(settlement?.studentId).toBe(item.studentId);
    expect(settlement?.settlementPeriod).toBe(item.familyDate);
    expect(settlement?.idempotencyKey).toBe(fact!.idempotencyKey);
    expect(ledger?.studentId).toBe(fact!.studentId);
    expect(ledger?.idempotencyKey).toBe(fact!.idempotencyKey);
    expect(ledger?.explanation).toContain(`completion_kind=${fact!.completionKind}`);
  });

  it("replays complete with same ledger and unchanged balance (F25)", async () => {
    const { studentId, items } = await seedPlanWithRule();
    const item = items.find((row) => row.familyDate === "2026-01-15");
    if (!item) throw new Error("Expected item");

    const first = await completeScheduleItem(db, {
      actorId: studentId,
      scheduleItemId: item.id,
      idempotencyKey: "settle-replay",
      now: FIXED_NOW,
    });

    const replay = await completeScheduleItem(db, {
      actorId: studentId,
      scheduleItemId: item.id,
      idempotencyKey: "settle-replay",
      now: FIXED_NOW,
    });

    expect(replay.idempotentReplay).toBe(true);
    expect(replay.ledgerEntryId).toBe(first.ledgerEntryId);
    expect(replay.settlementId).toBe(first.settlementId);

    const ledger = await db.select().from(pointLedgerEntries);
    expect(ledger).toHaveLength(1);

    const [balance] = await db
      .select()
      .from(pointBalanceProjection)
      .where(eq(pointBalanceProjection.studentId, studentId));
    expect(balance?.balance).toBe(10);
  });

  it("rejects complete replay when settlement is missing without mutating state (P4-R2-03)", async () => {
    const { studentId, items } = await seedPlanWithRule();
    const item = items.find((row) => row.familyDate === "2026-01-15");
    if (!item) throw new Error("Expected item");

    await completeScheduleItem(db, {
      actorId: studentId,
      scheduleItemId: item.id,
      idempotencyKey: "settle-missing-settlement",
      now: FIXED_NOW,
      settleForFact: async () => ({
        settlementId: "00000000-0000-4000-8000-000000000001",
        ledgerEntryId: "00000000-0000-4000-8000-000000000002",
      }),
    });

    const before = await captureSettlementState(db, studentId);

    await expect(
      completeScheduleItem(db, {
        actorId: studentId,
        scheduleItemId: item.id,
        idempotencyKey: "settle-missing-settlement",
        now: FIXED_NOW,
      }),
    ).rejects.toMatchObject({ code: "STATE_CONFLICT" satisfies ScheduleError["code"] });

    const after = await captureSettlementState(db, studentId);
    expect(after).toEqual(before);
    expect(before.settlements).toHaveLength(0);
    expect(before.ledgers).toHaveLength(0);
    expect(before.balance).toBeNull();
    expect(before.ledgerAudits).toHaveLength(0);
    expect(before.settledOutbox).toHaveLength(0);
  });

  it("rejects complete replay when ledger is missing without mutating state (P4-R3-03)", async () => {
    const { studentId, items } = await seedPlanWithRule();
    const item = items.find((row) => row.familyDate === "2026-01-15");
    if (!item) throw new Error("Expected item");

    const completed = await completeScheduleItem(db, {
      actorId: studentId,
      scheduleItemId: item.id,
      idempotencyKey: "settle-missing-ledger",
      now: FIXED_NOW,
    });

    const balanceLedgerFk = await findForeignKeyConstraint(db, {
      sourceTable: "point_balance_projection",
      sourceColumn: "last_ledger_entry_id",
      targetTable: "point_ledger_entries",
      targetColumn: "id",
    });

    await rollbackAfter(db, async (tx) => {
      await dropForeignKey(tx, "point_balance_projection", balanceLedgerFk.constraintName);
      await tx.delete(pointLedgerEntries);

      const before = await captureSettlementState(tx, studentId);
      expect(before.settlements).toHaveLength(1);
      expect(before.ledgers).toHaveLength(0);
      expect(before.balance?.balance).toBe(10);
      expect(before.balance?.lastLedgerEntryId).toBe(completed.ledgerEntryId);

      await expect(
        completeScheduleItem(tx, {
          actorId: studentId,
          scheduleItemId: item.id,
          idempotencyKey: "settle-missing-ledger",
          now: FIXED_NOW,
        }),
      ).rejects.toMatchObject({ code: "STATE_CONFLICT" satisfies ScheduleError["code"] });

      const after = await captureSettlementState(tx, studentId);
      expect(after).toEqual(before);
    });

    await assertForeignKeyExists(db, balanceLedgerFk);
  });

  it("concurrent settlement INSERT replays under unique constraint (P4-R2-01)", async () => {
    const { studentId, items } = await seedPlanWithRule();
    const item = items.find((row) => row.familyDate === "2026-01-15");
    if (!item) throw new Error("Expected item");

    const completed = await completeScheduleItem(db, {
      actorId: studentId,
      scheduleItemId: item.id,
      idempotencyKey: "settle-concurrent-insert",
      now: FIXED_NOW,
      settleForFact: async () => ({
        settlementId: "00000000-0000-4000-8000-000000000001",
        ledgerEntryId: "00000000-0000-4000-8000-000000000002",
      }),
    });

    const barrier = createConcurrentBarrier(2);

    const firstWriter = withIndependentTransaction((tx) =>
      settleForFact(
        tx,
        { factVersionId: completed.factVersionId },
        { testHooks: { beforeSettlementInsert: () => barrier.wait() } },
      ),
    );
    const secondWriter = withIndependentTransaction((tx) =>
      settleForFact(
        tx,
        { factVersionId: completed.factVersionId },
        { testHooks: { beforeSettlementInsert: () => barrier.wait() } },
      ),
    );

    const writers = Promise.all([firstWriter, secondWriter]);
    await barrier.waitAllReady();
    barrier.release();
    const [first, second] = await writers;

    expect(first.settlementId).toBe(second.settlementId);
    expect(first.ledgerEntryId).toBe(second.ledgerEntryId);
    expect(await db.select().from(settlements)).toHaveLength(1);
    expect(await db.select().from(pointLedgerEntries)).toHaveLength(1);

    const [balance] = await db
      .select()
      .from(pointBalanceProjection)
      .where(eq(pointBalanceProjection.studentId, studentId));
    expect(balance?.balance).toBe(10);
    expect(balance?.lastLedgerEntryId).toBe(first.ledgerEntryId);

    const ledgerAudits = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "point_ledger.created"));
    expect(ledgerAudits).toHaveLength(1);

    const settledOutbox = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.eventType, "points.settled"));
    expect(settledOutbox).toHaveLength(1);
    expect(settledOutbox[0]?.dedupeKey).toBe(`points.settled:${first.settlementId}`);
  });

  it("concurrent ledger INSERT replays under unique constraint (P4-R2-01)", async () => {
    const { studentId, items } = await seedPlanWithRule();
    const item = items.find((row) => row.familyDate === "2026-01-15");
    if (!item) throw new Error("Expected item");

    const completed = await completeScheduleItem(db, {
      actorId: studentId,
      scheduleItemId: item.id,
      idempotencyKey: "ledger-concurrent-insert",
      now: FIXED_NOW,
    });

    const [fact] = await db
      .select()
      .from(factVersions)
      .where(eq(factVersions.id, completed.factVersionId))
      .limit(1);
    if (!fact) throw new Error("Expected fact");

    await db.delete(pointBalanceProjection);
    await db.delete(pointLedgerEntries);
    await db.delete(auditEvents).where(eq(auditEvents.action, "point_ledger.created"));
    await db.delete(outboxEvents).where(eq(outboxEvents.eventType, "points.settled"));

    const ledgerInput = {
      studentId,
      settlementId: completed.settlementId,
      amount: 10,
      completionKind: fact.completionKind as "on_time" | "late",
      idempotencyKey: fact.idempotencyKey,
      now: FIXED_NOW,
    };

    const barrier = createConcurrentBarrier(2);

    const firstWriter = withIndependentTransaction((tx) =>
      appendLedgerForSettlement(tx, ledgerInput, {
        testHooks: { beforeLedgerInsert: () => barrier.wait() },
      }),
    );
    const secondWriter = withIndependentTransaction((tx) =>
      appendLedgerForSettlement(tx, ledgerInput, {
        testHooks: { beforeLedgerInsert: () => barrier.wait() },
      }),
    );

    const writers = Promise.all([firstWriter, secondWriter]);
    await barrier.waitAllReady();
    barrier.release();
    const [first, second] = await writers;

    expect(first.ledgerEntryId).toBe(second.ledgerEntryId);
    expect([first.created, second.created].filter(Boolean)).toHaveLength(1);
    expect([first.created, second.created].filter((created) => !created)).toHaveLength(1);
    expect(await db.select().from(settlements)).toHaveLength(1);
    expect(await db.select().from(pointLedgerEntries)).toHaveLength(1);

    const [balance] = await db
      .select()
      .from(pointBalanceProjection)
      .where(eq(pointBalanceProjection.studentId, studentId));
    expect(balance?.balance).toBe(10);
    expect(balance?.lastLedgerEntryId).toBe(first.ledgerEntryId);

    const ledgerAudits = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "point_ledger.created"));
    expect(ledgerAudits).toHaveLength(1);

    const settledOutbox = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.eventType, "points.settled"));
    expect(settledOutbox).toHaveLength(1);
    expect(settledOutbox[0]?.dedupeKey).toBe(`points.settled:${completed.settlementId}`);
  });

  it("rejects settleForFact when fact is missing (P4-R3-02)", async () => {
    const { studentId } = await seedPlanWithRule();
    const before = await captureSettlementState(db, studentId);

    await expect(
      db.transaction(async (tx) =>
        settleForFact(tx, { factVersionId: "00000000-0000-4000-8000-000000009999" }),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" satisfies SettlementError["code"] });

    const after = await captureSettlementState(db, studentId);
    expect(after).toEqual(before);
  });

  it("rejects settleForFact when fact and item student mismatch (P4-R3-02)", async () => {
    const { studentId, items } = await seedPlanWithRule();
    const item = items.find((row) => row.familyDate === "2026-01-15");
    if (!item) throw new Error("Expected item");

    const completed = await completeScheduleItem(db, {
      actorId: studentId,
      scheduleItemId: item.id,
      idempotencyKey: "fact-student-mismatch",
      now: FIXED_NOW,
    });

    const { studentId: otherStudentId } = await seedStudentUser(db, {
      username: `other_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });

    await db
      .update(factVersions)
      .set({ studentId: otherStudentId })
      .where(eq(factVersions.id, completed.factVersionId));

    const before = await captureSettlementState(db, studentId);

    await expect(
      db.transaction(async (tx) => settleForFact(tx, { factVersionId: completed.factVersionId })),
    ).rejects.toMatchObject({ code: "STATE_CONFLICT" satisfies SettlementError["code"] });

    const after = await captureSettlementState(db, studentId);
    expect(after).toEqual(before);
  });

  it("rejects settleForFact when schedule item is unavailable (P4-R3-01)", async () => {
    const { studentId, items } = await seedPlanWithRule();
    const item = items.find((row) => row.familyDate === "2026-01-15");
    if (!item) throw new Error("Expected item");

    const completed = await completeScheduleItem(db, {
      actorId: studentId,
      scheduleItemId: item.id,
      idempotencyKey: "fact-item-unavailable",
      now: FIXED_NOW,
    });

    const factItemFk = await findForeignKeyConstraint(db, {
      sourceTable: "fact_versions",
      sourceColumn: "schedule_item_id",
      targetTable: "schedule_items",
      targetColumn: "id",
    });
    const missingItemId = "00000000-0000-4000-8000-000000009999";

    await rollbackAfter(db, async (tx) => {
      await dropForeignKey(tx, "fact_versions", factItemFk.constraintName);
      await tx
        .update(factVersions)
        .set({ scheduleItemId: missingItemId })
        .where(eq(factVersions.id, completed.factVersionId));

      const before = await captureSettlementState(tx, studentId);

      await expect(
        settleForFact(tx, { factVersionId: completed.factVersionId }),
      ).rejects.toMatchObject({ code: "STATE_CONFLICT" satisfies SettlementError["code"] });

      const after = await captureSettlementState(tx, studentId);
      expect(after).toEqual(before);
    });

    await assertForeignKeyExists(db, factItemFk);
  });

  it("documents completion_kind CHECK prevents invalid fact fixture (P4-R2-02)", async () => {
    const rows = await db.execute(`
      SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conname = 'fact_versions_completion_kind_check'
    `);

    const definition = (rows[0] as { definition: string } | undefined)?.definition ?? "";
    expect(definition).toContain("on_time");
    expect(definition).toContain("late");
  });

  it("allows same client key across different schedule items (F13/F25)", async () => {
    const { parentId, studentId, created, items } = await seedPlanWithRule();
    const itemJan15 = items.find((row) => row.familyDate === "2026-01-15");
    if (!itemJan15) throw new Error("Expected today item");

    await db.execute(`
      INSERT INTO schedule_items (
        plan_id, plan_version_id, student_id, owner_id, family_date, slot_key,
        scheduled_at, status, source, occurrence_key
      ) VALUES (
        '${created.planId}', '${created.versionId}', '${studentId}', '${parentId}',
        '2026-01-14', 'default', '2026-01-14T12:00:00Z', 'pending', 'plan', 'shared-key-second-item'
      )
    `);

    const [itemJan14] = await db
      .select()
      .from(scheduleItems)
      .where(eq(scheduleItems.occurrenceKey, "shared-key-second-item"))
      .limit(1);

    if (!itemJan14) throw new Error("Expected second item");

    await completeScheduleItem(db, {
      actorId: studentId,
      scheduleItemId: itemJan14.id,
      idempotencyKey: "shared-client-key",
      now: FIXED_NOW,
    });

    await completeScheduleItem(db, {
      actorId: studentId,
      scheduleItemId: itemJan15.id,
      idempotencyKey: "shared-client-key",
      now: FIXED_NOW,
    });

    const ledger = await db.select().from(pointLedgerEntries);
    expect(ledger).toHaveLength(2);

    const [balance] = await db
      .select()
      .from(pointBalanceProjection)
      .where(eq(pointBalanceProjection.studentId, studentId));
    expect(balance?.balance).toBe(20);
  });

  it("sets source_id equal to settlement_id (R4)", async () => {
    const { studentId, items } = await seedPlanWithRule();
    const item = items.find((row) => row.familyDate === "2026-01-15");
    if (!item) throw new Error("Expected item");

    const result = await completeScheduleItem(db, {
      actorId: studentId,
      scheduleItemId: item.id,
      idempotencyKey: "settle-source-id",
      now: FIXED_NOW,
    });

    const [ledger] = await db
      .select()
      .from(pointLedgerEntries)
      .where(eq(pointLedgerEntries.id, result.ledgerEntryId));

    expect(ledger?.sourceId).toBe(result.settlementId);
    expect(ledger?.settlementId).toBe(result.settlementId);
  });

  it("skip produces no ledger (F17)", async () => {
    const { studentId, items } = await seedPlanWithRule();
    const item = items.find((row) => row.familyDate === "2026-01-15");
    if (!item) throw new Error("Expected item");

    await skipScheduleItem(db, {
      actorId: studentId,
      scheduleItemId: item.id,
      idempotencyKey: "skip-no-ledger",
      now: FIXED_NOW,
    });

    const ledger = await db.select().from(pointLedgerEntries);
    expect(ledger).toHaveLength(0);
  });

  it("window-outside complete produces no ledger (F7)", async () => {
    const { parentId, studentId, created } = await seedPlanWithRule();

    await db.execute(`
      INSERT INTO schedule_items (
        plan_id, plan_version_id, student_id, owner_id, family_date, slot_key,
        scheduled_at, status, source, occurrence_key
      ) VALUES (
        '${created.planId}', '${created.versionId}', '${studentId}', '${parentId}',
        '2026-01-01', 'default', '2026-01-01T12:00:00Z', 'pending', 'plan', 'manual-expired-settlement'
      )
    `);

    const [item] = await db
      .select()
      .from(scheduleItems)
      .where(eq(scheduleItems.occurrenceKey, "manual-expired-settlement"))
      .limit(1);

    await expect(
      completeScheduleItem(db, {
        actorId: studentId,
        scheduleItemId: item!.id,
        idempotencyKey: "complete-expired-settlement",
        now: FIXED_NOW,
      }),
    ).rejects.toMatchObject({ code: "WINDOW_EXPIRED" satisfies ScheduleError["code"] });

    const ledger = await db.select().from(pointLedgerEntries);
    expect(ledger).toHaveLength(0);
  });

  it("completed item with different key produces no new ledger (F3)", async () => {
    const { studentId, items } = await seedPlanWithRule();
    const item = items.find((row) => row.familyDate === "2026-01-15");
    if (!item) throw new Error("Expected item");

    await completeScheduleItem(db, {
      actorId: studentId,
      scheduleItemId: item.id,
      idempotencyKey: "settle-first-key",
      now: FIXED_NOW,
    });

    await expect(
      completeScheduleItem(db, {
        actorId: studentId,
        scheduleItemId: item.id,
        idempotencyKey: "settle-second-key",
        now: FIXED_NOW,
      }),
    ).rejects.toMatchObject({ code: "STATE_CONFLICT" });

    const ledger = await db.select().from(pointLedgerEntries);
    expect(ledger).toHaveLength(1);
  });

  it("concurrent complete yields single event/fact/settlement/ledger/audit/outbox (F24/P4-R2-04)", async () => {
    const { studentId, items } = await seedPlanWithRule();
    const item = items.find((row) => row.familyDate === "2026-01-15");
    if (!item) throw new Error("Expected item");

    const results = await Promise.all([
      completeScheduleItem(db, {
        actorId: studentId,
        scheduleItemId: item.id,
        idempotencyKey: "settle-outbox-concurrent",
        now: FIXED_NOW,
      }),
      completeScheduleItem(db, {
        actorId: studentId,
        scheduleItemId: item.id,
        idempotencyKey: "settle-outbox-concurrent",
        now: FIXED_NOW,
      }),
    ]);

    expect(results).toHaveLength(2);
    expect(results.filter((result) => result.idempotentReplay)).toHaveLength(1);
    expect(results[0]!.settlementId).toBe(results[1]!.settlementId);
    expect(results[0]!.ledgerEntryId).toBe(results[1]!.ledgerEntryId);
    expect(results[0]!.eventId).toBe(results[1]!.eventId);
    expect(results[0]!.factVersionId).toBe(results[1]!.factVersionId);

    const events = await db
      .select()
      .from(scheduleEvents)
      .where(eq(scheduleEvents.scheduleItemId, item.id));
    expect(events).toHaveLength(1);
    expect(events[0]!.id).toBe(results[0]!.eventId);

    const facts = await db
      .select()
      .from(factVersions)
      .where(eq(factVersions.scheduleItemId, item.id));
    expect(facts).toHaveLength(1);
    expect(facts[0]!.id).toBe(results[0]!.factVersionId);

    const settlementRows = await db.select().from(settlements);
    expect(settlementRows).toHaveLength(1);
    expect(settlementRows[0]!.id).toBe(results[0]!.settlementId);

    const ledgerRows = await db.select().from(pointLedgerEntries);
    expect(ledgerRows).toHaveLength(1);
    expect(ledgerRows[0]!.id).toBe(results[0]!.ledgerEntryId);

    const [balance] = await db
      .select()
      .from(pointBalanceProjection)
      .where(eq(pointBalanceProjection.studentId, studentId));
    expect(balance?.balance).toBe(10);
    expect(balance?.lastLedgerEntryId).toBe(results[0]!.ledgerEntryId);

    const ledgerAudits = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "point_ledger.created"));
    expect(ledgerAudits).toHaveLength(1);
    expect(ledgerAudits[0]!.resourceId).toBe(results[0]!.ledgerEntryId);

    const settledOutbox = await db
      .select()
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.eventType, "points.settled"),
          eq(outboxEvents.dedupeKey, `points.settled:${settlementRows[0]!.id}`),
        ),
      );
    expect(settledOutbox).toHaveLength(1);
    expect(settledOutbox[0]!.aggregateId).toBe(results[0]!.settlementId);
  });

  it("enable point rule replays same rule on same key with single audit/outbox (F11-F13/P4-R2-04)", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);

    const first = await enablePointRule(db, {
      parentId,
      studentId,
      idempotencyKey: "enable-rule-replay",
      body: { templateId: "schedule_system_complete_v1" },
      now: FIXED_NOW,
    });

    const replay = await enablePointRule(db, {
      parentId,
      studentId,
      idempotencyKey: "enable-rule-replay",
      body: { templateId: "schedule_system_complete_v1" },
      now: FIXED_NOW,
    });

    expect(replay.idempotentReplay).toBe(true);
    expect(replay.ruleId).toBe(first.ruleId);
    expect(replay.ruleVersionId).toBe(first.ruleVersionId);

    const rules = await db.select().from(pointRules).where(eq(pointRules.studentId, studentId));
    expect(rules).toHaveLength(1);

    const versions = await db
      .select()
      .from(pointRuleVersions)
      .where(eq(pointRuleVersions.pointRuleId, first.ruleId));
    expect(versions).toHaveLength(1);

    const ruleAudits = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "point_rule.enabled"));
    expect(ruleAudits).toHaveLength(1);
    expect(ruleAudits[0]!.resourceId).toBe(first.ruleId);

    const ruleOutbox = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.eventType, "point_rule.enabled"));
    expect(ruleOutbox).toHaveLength(1);
    expect(ruleOutbox[0]!.aggregateId).toBe(first.ruleId);
  });

  it("rejects enable point rule for unverified parent (P4-R06)", async () => {
    const { studentId } = await bootstrapParentStudentRelationship(db);
    const { registerParent } = await import("@/modules/identity/registration.service");
    const { adminId } = await bootstrapAdmin(
      db,
      `admin-unverified-${crypto.randomUUID()}@test.local`,
    );
    const invite = await createInvitation(db, {
      adminId,
      targetRole: "parent",
      idempotencyKey: `invite-unverified-${crypto.randomUUID()}`,
    });

    const unverified = await registerParent(db, {
      invitationCode: invite.codePlaintext,
      displayName: "Unverified Parent",
      email: `unverified-${crypto.randomUUID()}@test.local`,
      password: "ParentPass123!Parent",
      idempotencyKey: `register-unverified-${crypto.randomUUID()}`,
    });

    await expect(
      enablePointRule(db, {
        parentId: unverified.userId,
        studentId,
        idempotencyKey: "enable-unverified",
        body: { templateId: "schedule_system_complete_v1" },
        now: FIXED_NOW,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" satisfies SettlementError["code"] });
  });

  it("rejects enable point rule without relationship (P4-R06)", async () => {
    const pairA = await bootstrapParentStudentRelationship(db);
    const pairB = await bootstrapParentStudentRelationship(db);

    await expect(
      enablePointRule(db, {
        parentId: pairA.parentId,
        studentId: pairB.studentId,
        idempotencyKey: "enable-no-relationship",
        body: { templateId: "schedule_system_complete_v1" },
        now: FIXED_NOW,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" satisfies SettlementError["code"] });
  });

  it("rejects enable point rule replay with mismatched payload hash (P4-R06)", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);

    await enablePointRule(db, {
      parentId,
      studentId,
      idempotencyKey: "enable-hash-mismatch",
      body: { templateId: "schedule_system_complete_v1" },
      now: FIXED_NOW,
    });

    await expect(
      enablePointRule(db, {
        parentId,
        studentId,
        idempotencyKey: "enable-hash-mismatch",
        body: { templateId: "schedule_system_complete_v1", note: "different" } as {
          templateId: "schedule_system_complete_v1";
        },
        now: FIXED_NOW,
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" satisfies SettlementError["code"] });
  });

  it("rejects second active point rule for same student (P4-R06)", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);

    await enablePointRule(db, {
      parentId,
      studentId,
      idempotencyKey: "enable-first-rule",
      body: { templateId: "schedule_system_complete_v1" },
      now: FIXED_NOW,
    });

    await expect(
      enablePointRule(db, {
        parentId,
        studentId,
        idempotencyKey: "enable-second-rule",
        body: { templateId: "schedule_system_complete_v1" },
        now: FIXED_NOW,
      }),
    ).rejects.toMatchObject({ code: "STATE_CONFLICT" satisfies SettlementError["code"] });
  });

  it("snapshots v1 rule version fields from template (P4-R06)", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);

    const result = await enablePointRule(db, {
      parentId,
      studentId,
      idempotencyKey: "enable-version-snapshot",
      body: { templateId: "schedule_system_complete_v1" },
      now: FIXED_NOW,
    });

    const [rule] = await db
      .select()
      .from(pointRules)
      .where(eq(pointRules.id, result.ruleId))
      .limit(1);
    const [version] = await db
      .select()
      .from(pointRuleVersions)
      .where(eq(pointRuleVersions.id, result.ruleVersionId))
      .limit(1);

    expect(rule?.active).toBe(true);
    expect(version?.version).toBe(1);
    expect(version?.status).toBe("active");
    expect(version?.parameters).toEqual({});
    expect(version?.effect).toEqual({ amount: 10, rewardsLateCompletion: true });
  });

  it("creates scoped audit/outbox when same client key is reused across students (P4-R05/P4-R06)", async () => {
    const { parentId, studentId: studentA } = await bootstrapParentStudentRelationship(db);
    const { studentId: studentB } = await seedStudentUser(db, {
      username: `student_b_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });

    const { issueAssociationCode } =
      await import("@/modules/family-access/association-code.service");
    const { acceptRelationshipRequest, createRelationshipRequest } =
      await import("@/modules/family-access/relationship-request.service");

    const code = await issueAssociationCode(db, {
      studentId: studentB,
      idempotencyKey: `issue-b-${crypto.randomUUID()}`,
    });
    const request = await createRelationshipRequest(db, {
      parentId,
      associationCodePlaintext: code.codePlaintext,
      idempotencyKey: `req-b-${crypto.randomUUID()}`,
    });
    await acceptRelationshipRequest(db, {
      studentId: studentB,
      requestId: request.requestId,
      idempotencyKey: `accept-b-${crypto.randomUUID()}`,
    });

    const sharedKey = "shared-enable-key";
    const first = await enablePointRule(db, {
      parentId,
      studentId: studentA,
      idempotencyKey: sharedKey,
      body: { templateId: "schedule_system_complete_v1" },
      now: FIXED_NOW,
    });
    const second = await enablePointRule(db, {
      parentId,
      studentId: studentB,
      idempotencyKey: sharedKey,
      body: { templateId: "schedule_system_complete_v1" },
      now: FIXED_NOW,
    });

    const ruleAudits = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "point_rule.enabled"));
    expect(ruleAudits).toHaveLength(2);
    expect(ruleAudits.map((row) => row.resourceId).sort()).toEqual(
      [first.ruleId, second.ruleId].sort(),
    );

    const ruleOutbox = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.eventType, "point_rule.enabled"));
    expect(ruleOutbox).toHaveLength(2);
    expect(ruleOutbox.map((row) => row.aggregateId).sort()).toEqual(
      [first.ruleId, second.ruleId].sort(),
    );
  });
});
