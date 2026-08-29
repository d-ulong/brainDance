import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { config } from "dotenv";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { type TestDb } from "../../helpers/db";
import { bootstrapVerifiedParentWithInvite, seedStudentUser } from "../../helpers/family-access";
import {
  adminDatabaseUrl,
  closeIsolatedM2Database,
  databaseUrlForName,
  openIsolatedM2Database,
  type IsolatedM2Database,
} from "./m2-isolated-database";

config({ path: ".env.local" });
config({ path: ".env" });

const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);
const MISSING_UUID = "00000000-0000-0000-0000-000000000099";
const M2_TABLES = [
  "goals",
  "plans",
  "plan_versions",
  "plan_schedule_slots",
  "schedule_items",
  "schedule_events",
  "schedule_horizon_maintains",
  "fact_versions",
  "point_rule_templates",
  "point_rules",
  "point_rule_versions",
  "settlements",
  "point_ledger_entries",
  "point_balance_projection",
] as const;

type PgFailure = { code?: string; constraint?: string; column?: string };
type ColumnContractRow = { column_name: string; is_nullable: string };

function unwrapPgFailure(error: unknown): PgFailure {
  let current: unknown = error;
  for (let i = 0; i < 6 && current && typeof current === "object"; i += 1) {
    const record = current as Record<string, unknown>;
    const code = typeof record.code === "string" ? record.code : undefined;
    if (code && /^\d{5}$/.test(code)) {
      const constraint =
        (typeof record.constraint_name === "string" && record.constraint_name) ||
        (typeof record.constraint === "string" && record.constraint) ||
        undefined;
      const column =
        (typeof record.column_name === "string" && record.column_name) ||
        (typeof record.column === "string" && record.column) ||
        undefined;
      return { code, constraint, column };
    }
    current = record.cause ?? record.originalError;
  }
  return {};
}

async function expectConstraintFailure(
  executor: { execute: TestDb["execute"] },
  statement: ReturnType<typeof sql>,
  expected: { code: string; constraint?: string; column?: string },
): Promise<void> {
  try {
    await executor.execute(statement);
    throw new Error(
      `Expected SQLSTATE ${expected.code}${expected.constraint ? ` ${expected.constraint}` : ""} but the statement succeeded`,
    );
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Expected SQLSTATE")) {
      throw error;
    }
    const failure = unwrapPgFailure(error);
    expect(failure.code, `SQLSTATE for ${expected.constraint ?? expected.column}`).toBe(
      expected.code,
    );
    if (expected.constraint) {
      expect(failure.constraint).toBe(expected.constraint);
    }
    if (expected.column) {
      expect(failure.column).toBe(expected.column);
    }
  }
}

async function expectConstraintFailureOneOf(
  executor: { execute: TestDb["execute"] },
  statement: ReturnType<typeof sql>,
  expected: { code: string; constraints: string[] },
): Promise<void> {
  try {
    await executor.execute(statement);
    throw new Error(`Expected SQLSTATE ${expected.code} but the statement succeeded`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Expected SQLSTATE")) {
      throw error;
    }
    const failure = unwrapPgFailure(error);
    expect(failure.code).toBe(expected.code);
    expect(expected.constraints).toContain(failure.constraint);
  }
}

async function getCheckConstraintDefs(db: TestDb, tableName: string): Promise<Map<string, string>> {
  const rows = await db.execute(sql`
    SELECT conname, pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conrelid = ${tableName}::regclass AND contype = 'c'
  `);
  return new Map(
    (rows as unknown as { conname: string; def: string }[]).map((row) => [row.conname, row.def]),
  );
}

async function listColumnContracts(
  db: TestDb,
  tableName: string,
): Promise<Map<string, "YES" | "NO">> {
  const rows = await db.execute(sql`
    SELECT column_name, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${tableName}
  `);
  return new Map(
    (rows as unknown as ColumnContractRow[]).map((row) => [
      row.column_name,
      row.is_nullable as "YES" | "NO",
    ]),
  );
}

async function foreignKeyTarget(
  db: TestDb,
  tableName: string,
  columnName: string,
): Promise<{ table?: string; constraint?: string }> {
  const rows = await db.execute(sql`
    SELECT tc.constraint_name, ccu.table_name AS foreign_table_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
      AND tc.table_name = ${tableName}
      AND kcu.column_name = ${columnName}
  `);
  const match = (rows as unknown as { constraint_name: string; foreign_table_name: string }[])[0];
  return { table: match?.foreign_table_name, constraint: match?.constraint_name };
}

async function resetM2Tables(db: TestDb): Promise<void> {
  await db.execute(sql`
    TRUNCATE TABLE
      schedule_horizon_maintains,
      point_balance_projection,
      point_ledger_entries,
      settlements,
      point_rule_versions,
      point_rules,
      fact_versions,
      schedule_events,
      schedule_items,
      plan_schedule_slots,
      plans,
      plan_versions,
      goals
    RESTART IDENTITY CASCADE
  `);
}

async function seedParentStudent(db: TestDb) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const { parentId } = await bootstrapVerifiedParentWithInvite(db, `parent_${suffix}@test.local`);
  const { studentId } = await seedStudentUser(db, {
    username: `student_${suffix}`,
    password: "StudentPass123!Student",
  });
  return { parentId, studentId };
}

async function insertPlan(
  db: TestDb,
  input: {
    parentId: string;
    studentId: string;
    key: string;
    status?: string;
    planKind?: string;
    deactivateKey?: string | null;
  },
) {
  const status = input.status ?? "active";
  const planKind = input.planKind ?? "formal";
  const payloadHash = `hash-${input.key}`;
  const rows = await db.execute(sql`
    INSERT INTO plans (
      student_id, owner_id, plan_kind, status, title, start_date,
      create_idempotency_key, create_idempotency_payload_hash,
      deactivate_idempotency_key, deactivate_idempotency_payload_hash
    ) VALUES (
      ${input.studentId}::uuid, ${input.parentId}::uuid, ${planKind}, ${status}, 'Test Plan', '2026-01-01',
      ${input.key}, ${payloadHash}, ${input.deactivateKey ?? null}, ${input.deactivateKey ? `hash-${input.deactivateKey}` : null}
    )
    RETURNING id
  `);
  return (rows[0] as { id: string }).id;
}

async function insertPlanVersion(
  db: TestDb,
  input: { planId: string; version: number; key: string },
) {
  const now = new Date().toISOString();
  const rows = await db.execute(sql`
    INSERT INTO plan_versions (
      plan_id, version, schedule_rule, effective_from, created_at,
      create_idempotency_key, create_idempotency_payload_hash
    ) VALUES (
      ${input.planId}::uuid, ${input.version}, '{"frequency":"daily"}'::jsonb, '2026-01-01', ${now}::timestamptz,
      ${input.key}, ${`hash-${input.key}`}
    )
    RETURNING id
  `);
  return (rows[0] as { id: string }).id;
}

async function seedFormalPlan(
  db: TestDb,
  input: { parentId: string; studentId: string; key: string; status?: string; planKind?: string },
) {
  const planId = await insertPlan(db, input);
  const versionId = await insertPlanVersion(db, { planId, version: 1, key: `v1-${input.key}` });
  await db.execute(sql`
    UPDATE plans SET current_version = ${versionId}::uuid WHERE id = ${planId}::uuid
  `);
  return { planId, versionId };
}

async function seedScheduleItem(
  db: TestDb,
  input: { planId: string; versionId: string; studentId: string; parentId: string; key: string },
) {
  const scheduledAt = new Date("2026-01-01T12:00:00.000Z").toISOString();
  const rows = await db.execute(sql`
    INSERT INTO schedule_items (
      plan_id, plan_version_id, student_id, owner_id, family_date, slot_key,
      scheduled_at, status, source, occurrence_key
    ) VALUES (
      ${input.planId}::uuid, ${input.versionId}::uuid, ${input.studentId}::uuid, ${input.parentId}::uuid,
      '2026-01-01', 'default', ${scheduledAt}::timestamptz, 'pending', 'plan',
      ${`occ-${input.key}`}
    )
    RETURNING id
  `);
  return (rows[0] as { id: string }).id;
}

async function insertFact(db: TestDb, input: { itemId: string; studentId: string; key: string }) {
  const ts = new Date("2026-01-01T13:00:00.000Z").toISOString();
  const rows = await db.execute(sql`
    INSERT INTO fact_versions (
      schedule_item_id, student_id, fact_key, source_kind, value,
      idempotency_key, idempotency_payload_hash, completion_kind,
      occurred_at, asserted_at, recorded_at
    ) VALUES (
      ${input.itemId}::uuid, ${input.studentId}::uuid, 'schedule.completed', 'system',
      '{"completion_kind":"on_time"}'::jsonb, ${input.key}, 'hash', 'on_time',
      ${ts}::timestamptz, ${ts}::timestamptz, ${ts}::timestamptz
    )
    RETURNING id
  `);
  return (rows[0] as { id: string }).id;
}

async function seedSettlementGraph(db: TestDb, settlementCount: number) {
  const { parentId, studentId } = await seedParentStudent(db);
  const { planId, versionId } = await seedFormalPlan(db, {
    parentId,
    studentId,
    key: `graph-${crypto.randomUUID().slice(0, 8)}`,
  });
  const ts = new Date("2026-01-01T13:00:00.000Z").toISOString();
  const itemId = await seedScheduleItem(db, {
    planId,
    versionId,
    studentId,
    parentId,
    key: `graph-item-${crypto.randomUUID().slice(0, 8)}`,
  });

  const ruleRows = await db.execute(sql`
    INSERT INTO point_rules (
      student_id, creator_parent_id, template_id, active,
      create_idempotency_key, create_idempotency_payload_hash, created_at
    ) VALUES (
      ${studentId}::uuid, ${parentId}::uuid, 'schedule_system_complete_v1', false,
      ${`graph-rule-${crypto.randomUUID()}`}, 'hash', ${ts}::timestamptz
    )
    RETURNING id
  `);
  const pointRuleId = (ruleRows[0] as { id: string }).id;
  const ruleVersionRows = await db.execute(sql`
    INSERT INTO point_rule_versions (
      point_rule_id, version, parameters, effect, priority, effective_at, status
    ) VALUES (
      ${pointRuleId}::uuid, 1, '{}'::jsonb, '{"amount":10}'::jsonb, NULL, ${ts}::timestamptz, 'active'
    )
    RETURNING id
  `);
  const ruleVersionId = (ruleVersionRows[0] as { id: string }).id;

  const settlements: string[] = [];
  const facts: string[] = [];
  for (let i = 0; i < settlementCount; i += 1) {
    const factId = await insertFact(db, {
      itemId,
      studentId,
      key: `graph-fact-${i}-${crypto.randomUUID()}`,
    });
    facts.push(factId);
    const settlementRows = await db.execute(sql`
      INSERT INTO settlements (
        student_id, fact_version_id, rule_version_id, settlement_period,
        result, explanation, idempotency_key
      ) VALUES (
        ${studentId}::uuid, ${factId}::uuid, ${ruleVersionId}::uuid, '2026-01-01',
        'reward', 'graph settlement', ${`graph-settlement-${i}-${crypto.randomUUID()}`}
      )
      RETURNING id
    `);
    settlements.push((settlementRows[0] as { id: string }).id);
  }

  return {
    parentId,
    studentId,
    planId,
    versionId,
    itemId,
    pointRuleId,
    ruleVersionId,
    facts,
    settlements,
  };
}

async function assertMigratedHead(connectionString: string): Promise<void> {
  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client);
  try {
    const journal = JSON.parse(
      readFileSync(path.join(process.cwd(), "src/db/migrations/meta/_journal.json"), "utf8"),
    ) as { entries: { tag: string }[] };
    expect(journal.entries.at(-1)?.tag).toBe("0016_m3_p2_remediation");

    const applied = await db.execute(
      sql`SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations`,
    );
    expect((applied[0] as { count: number }).count).toBe(17);

    for (const table of M2_TABLES) {
      const rows = await db.execute(sql`
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ${table}
      `);
      expect(rows.length, table).toBe(1);
    }

    const seed = await db.execute(sql`
      SELECT id, effect_schema FROM point_rule_templates WHERE id = 'schedule_system_complete_v1'
    `);
    expect(seed).toHaveLength(1);
    expect(
      (seed[0] as { effect_schema: { amount: number; rewardsLateCompletion: boolean } })
        .effect_schema,
    ).toEqual({
      amount: 10,
      rewardsLateCompletion: true,
    });

    const goalFk = await foreignKeyTarget(db as unknown as TestDb, "plans", "goal_id");
    expect(goalFk.table).toBe("goals");
  } finally {
    await client.end({ timeout: 5 });
  }
}

async function migrateFolder(connectionString: string, folder: string): Promise<void> {
  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client);
  try {
    await migrate(db, { migrationsFolder: folder });
  } finally {
    await client.end({ timeout: 5 });
  }
}

async function withTempDatabase(
  namePrefix: string,
  run: (databaseUrl: string) => Promise<void>,
): Promise<void> {
  const rootUrl = process.env.DATABASE_URL!;
  const dbName = `${namePrefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const admin = postgres(adminDatabaseUrl(rootUrl), { max: 1 });
  try {
    await admin.unsafe(`CREATE DATABASE "${dbName}"`);
    await run(databaseUrlForName(rootUrl, dbName));
  } finally {
    await admin.unsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${dbName}' AND pid <> pg_backend_pid()`,
    );
    await admin.unsafe(`DROP DATABASE IF EXISTS "${dbName}"`);
    await admin.end({ timeout: 5 });
  }
}

function writeMainThrough0007Folder(): string {
  const folder = mkdtempSync(path.join(tmpdir(), "m2-mig-0007-"));
  const source = path.join(process.cwd(), "src/db/migrations");
  for (const file of [
    "0000_bootstrap.sql",
    "0001_identity.sql",
    "0002_family_access.sql",
    "0003_training.sql",
    "0004_guardian_consents.sql",
    "0005_training_idempotency_scope.sql",
    "0006_outbox_events.sql",
    "0007_controlled_student_password.sql",
  ]) {
    cpSync(path.join(source, file), path.join(folder, file));
  }
  mkdirSync(path.join(folder, "meta"));
  const journal = JSON.parse(readFileSync(path.join(source, "meta/_journal.json"), "utf8")) as {
    version: string;
    dialect: string;
    entries: { idx: number }[];
  };
  journal.entries = journal.entries.filter((entry) => entry.idx <= 7);
  writeFileSync(path.join(folder, "meta/_journal.json"), JSON.stringify(journal, null, 2), "utf8");
  return folder;
}

describe.skipIf(!hasDb)("m2 schema constraints", () => {
  let db: TestDb;
  let isolatedDb: IsolatedM2Database | undefined;

  beforeAll(async () => {
    isolatedDb = await openIsolatedM2Database();
    db = isolatedDb.db;
  }, 120_000);

  beforeEach(async () => {
    await resetM2Tables(db);
  });

  afterAll(async () => {
    if (isolatedDb) {
      await closeIsolatedM2Database(isolatedDb);
    }
  });

  it("enforces full column nullability contracts from implement §2.0–§2.0.7", async () => {
    const required: Record<string, string[]> = {
      goals: ["id", "student_id", "creator_id", "title", "status", "start_date"],
      plans: [
        "id",
        "student_id",
        "owner_id",
        "plan_kind",
        "status",
        "title",
        "start_date",
        "create_idempotency_key",
        "create_idempotency_payload_hash",
      ],
      plan_versions: [
        "id",
        "plan_id",
        "version",
        "schedule_rule",
        "effective_from",
        "created_at",
        "create_idempotency_key",
        "create_idempotency_payload_hash",
      ],
      plan_schedule_slots: ["id", "plan_version_id", "slot_key", "local_time"],
      schedule_items: [
        "id",
        "plan_id",
        "plan_version_id",
        "student_id",
        "owner_id",
        "family_date",
        "slot_key",
        "scheduled_at",
        "status",
        "source",
        "occurrence_key",
      ],
      schedule_events: [
        "id",
        "schedule_item_id",
        "actor_id",
        "from_status",
        "to_status",
        "idempotency_key",
        "idempotency_payload_hash",
        "occurred_at",
      ],
      fact_versions: [
        "id",
        "student_id",
        "fact_key",
        "source_kind",
        "value",
        "idempotency_key",
        "idempotency_payload_hash",
        "completion_kind",
        "occurred_at",
        "asserted_at",
        "recorded_at",
      ],
      point_rule_templates: [
        "id",
        "event_type",
        "parameter_schema",
        "effect_schema",
        "stacking_mode",
        "active",
        "created_at",
      ],
      point_rules: [
        "id",
        "student_id",
        "creator_parent_id",
        "template_id",
        "active",
        "create_idempotency_key",
        "create_idempotency_payload_hash",
        "created_at",
      ],
      point_rule_versions: [
        "id",
        "point_rule_id",
        "version",
        "parameters",
        "effect",
        "effective_at",
        "status",
      ],
      settlements: [
        "id",
        "student_id",
        "fact_version_id",
        "rule_version_id",
        "settlement_period",
        "result",
        "explanation",
        "idempotency_key",
      ],
      point_ledger_entries: [
        "id",
        "student_id",
        "settlement_id",
        "amount",
        "reason",
        "source_type",
        "explanation",
        "source_id",
        "idempotency_key",
      ],
      point_balance_projection: ["student_id", "balance", "updated_at"],
      schedule_horizon_maintains: [
        "id",
        "student_id",
        "actor_id",
        "idempotency_key",
        "idempotency_payload_hash",
        "items_created",
        "created_at",
      ],
    };
    const nullable: Record<string, string[]> = {
      goals: ["due_date", "closed_at"],
      plans: [
        "goal_id",
        "source_plan_id",
        "current_version",
        "description",
        "end_date",
        "deactivate_idempotency_key",
        "deactivate_idempotency_payload_hash",
      ],
      plan_versions: ["effective_until"],
      schedule_items: ["plan_snapshot"],
      schedule_events: ["completion_kind", "reason"],
      fact_versions: [
        "schedule_item_id",
        "confirmed_at",
        "confirmed_by",
        "submitted_by",
        "correction_reason",
        "supersedes_fact_version_id",
        "voided_at",
      ],
      point_rule_templates: ["negative_effect_schema", "limits"],
      point_rule_versions: ["priority"],
      point_ledger_entries: ["reverses_entry_id", "created_by"],
      point_balance_projection: ["last_ledger_entry_id"],
    };

    for (const [table, columns] of Object.entries(required)) {
      const contracts = await listColumnContracts(db, table);
      expect(contracts.has("current_version_id")).toBe(false);
      for (const column of columns) {
        expect(contracts.get(column), `${table}.${column} NOT NULL`).toBe("NO");
      }
    }
    for (const [table, columns] of Object.entries(nullable)) {
      const contracts = await listColumnContracts(db, table);
      for (const column of columns) {
        expect(contracts.get(column), `${table}.${column} NULL`).toBe("YES");
      }
    }

    const planColumns = await listColumnContracts(db, "plans");
    expect(planColumns.has("current_version")).toBe(true);
    expect(planColumns.has("current_version_id")).toBe(false);
  });

  it("isolates plans unique, partial unique, status CHECK, and current_version/goal FKs", async () => {
    const { parentId, studentId } = await seedParentStudent(db);
    const { studentId: studentB } = await seedStudentUser(db, {
      username: `student_b_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });

    await insertPlan(db, { parentId, studentId, key: "create-a", status: "inactive" });
    await expectConstraintFailure(
      db,
      sql`
        INSERT INTO plans (
          student_id, owner_id, plan_kind, status, title, start_date,
          create_idempotency_key, create_idempotency_payload_hash
        ) VALUES (
          ${studentId}::uuid, ${parentId}::uuid, 'formal', 'inactive', 'Dup Create', '2026-01-01',
          'create-a', 'hash-other'
        )
      `,
      { code: "23505", constraint: "plans_create_idempotency_unique" },
    );

    const deactivatePlanId = await insertPlan(db, {
      parentId,
      studentId: studentB,
      key: "deact-1",
      status: "inactive",
      deactivateKey: "same-deact-key",
    });
    const secondDeactivatePlanId = await insertPlan(db, {
      parentId,
      studentId,
      key: "deact-2",
      status: "inactive",
      deactivateKey: "same-deact-key",
    });
    expect(deactivatePlanId).not.toBe(secondDeactivatePlanId);
    const deactivateIndex = await db.execute(sql`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND indexname = 'plans_deactivate_idempotency_unique'
    `);
    expect((deactivateIndex[0] as { indexdef: string }).indexdef).toContain(
      "deactivate_idempotency_key",
    );
    expect((deactivateIndex[0] as { indexdef: string }).indexdef.toLowerCase()).toContain(
      "is not null",
    );

    await seedFormalPlan(db, { parentId, studentId, key: "formal-active" });
    await expectConstraintFailure(
      db,
      sql`
        INSERT INTO plans (
          student_id, owner_id, plan_kind, status, title, start_date,
          create_idempotency_key, create_idempotency_payload_hash
        ) VALUES (
          ${studentId}::uuid, ${parentId}::uuid, 'formal', 'active', 'Second Formal', '2026-01-01',
          'formal-active-2', 'hash'
        )
      `,
      { code: "23505", constraint: "plans_active_formal_student_unique" },
    );
    await insertPlan(db, { parentId, studentId, key: "inactive-formal", status: "inactive" });
    await insertPlan(db, {
      parentId,
      studentId,
      key: "active-personal",
      status: "active",
      planKind: "personal",
    });

    await expectConstraintFailure(
      db,
      sql`
        INSERT INTO plans (
          student_id, owner_id, plan_kind, status, title, start_date,
          create_idempotency_key, create_idempotency_payload_hash
        ) VALUES (
          ${studentId}::uuid, ${parentId}::uuid, 'formal', 'archived', 'Bad Status', '2026-01-01',
          'bad-status', 'hash'
        )
      `,
      { code: "23514", constraint: "plans_status_check" },
    );

    const currentVersionFk = await foreignKeyTarget(db, "plans", "current_version");
    expect(currentVersionFk.table).toBe("plan_versions");
    await expectConstraintFailure(
      db,
      sql`
        INSERT INTO plans (
          student_id, owner_id, plan_kind, status, current_version, title, start_date,
          create_idempotency_key, create_idempotency_payload_hash
        ) VALUES (
          ${studentId}::uuid, ${parentId}::uuid, 'formal', 'inactive', ${MISSING_UUID}::uuid,
          'Bad Version FK', '2026-01-01', 'bad-current-version', 'hash'
        )
      `,
      { code: "23503", constraint: currentVersionFk.constraint },
    );

    const goalFk = await foreignKeyTarget(db, "plans", "goal_id");
    expect(goalFk.table).toBe("goals");
    await expectConstraintFailure(
      db,
      sql`
        INSERT INTO plans (
          student_id, owner_id, goal_id, plan_kind, status, title, start_date,
          create_idempotency_key, create_idempotency_payload_hash
        ) VALUES (
          ${studentId}::uuid, ${parentId}::uuid, ${MISSING_UUID}::uuid, 'formal', 'inactive',
          'Bad Goal', '2026-01-01', 'bad-goal', 'hash'
        )
      `,
      { code: "23503", constraint: goalFk.constraint },
    );
  });

  it("isolates plan_versions uniques across same and different plans", async () => {
    const { parentId, studentId } = await seedParentStudent(db);
    const { studentId: studentB } = await seedStudentUser(db, {
      username: `student_c_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });
    const planA = await seedFormalPlan(db, { parentId, studentId, key: "pv-a" });
    const planB = await seedFormalPlan(db, { parentId, studentId: studentB, key: "pv-b" });

    await expectConstraintFailure(
      db,
      sql`
        INSERT INTO plan_versions (
          plan_id, version, schedule_rule, effective_from, created_at,
          create_idempotency_key, create_idempotency_payload_hash
        ) VALUES (
          ${planA.planId}::uuid, 2, '{"frequency":"daily"}'::jsonb, '2026-01-02', ${new Date().toISOString()}::timestamptz,
          'v1-pv-a', 'hash-other'
        )
      `,
      { code: "23505", constraint: "plan_versions_plan_create_idempotency_unique" },
    );
    await expectConstraintFailure(
      db,
      sql`
        INSERT INTO plan_versions (
          plan_id, version, schedule_rule, effective_from, created_at,
          create_idempotency_key, create_idempotency_payload_hash
        ) VALUES (
          ${planA.planId}::uuid, 1, '{"frequency":"daily"}'::jsonb, '2026-01-02', ${new Date().toISOString()}::timestamptz,
          'v1-pv-a-dup-version', 'hash'
        )
      `,
      { code: "23505", constraint: "plan_versions_plan_version_unique" },
    );

    const cross = await db.execute(sql`
      SELECT plan_id FROM plan_versions WHERE version = 1 AND plan_id IN (${planA.planId}::uuid, ${planB.planId}::uuid)
    `);
    expect(cross).toHaveLength(2);
  });

  it("enforces plan_schedule_slots unique (plan_version_id, slot_key)", async () => {
    const { parentId, studentId } = await seedParentStudent(db);
    const { versionId } = await seedFormalPlan(db, { parentId, studentId, key: "slot" });
    await db.execute(sql`
      INSERT INTO plan_schedule_slots (plan_version_id, slot_key, local_time)
      VALUES (${versionId}::uuid, 'default', '20:00')
    `);
    await expectConstraintFailure(
      db,
      sql`
        INSERT INTO plan_schedule_slots (plan_version_id, slot_key, local_time)
        VALUES (${versionId}::uuid, 'default', '21:00')
      `,
      { code: "23505", constraint: "plan_schedule_slots_version_slot_unique" },
    );
  });

  it("enforces schedule_items occurrence_key unique", async () => {
    const { parentId, studentId } = await seedParentStudent(db);
    const { planId, versionId } = await seedFormalPlan(db, { parentId, studentId, key: "occ-dup" });
    const occurrenceKey = "occ-occ-dup";
    const scheduledAt = new Date("2026-01-01T12:00:00.000Z").toISOString();

    await db.execute(sql`
      INSERT INTO schedule_items (
        plan_id, plan_version_id, student_id, owner_id, family_date, slot_key,
        scheduled_at, status, source, occurrence_key
      ) VALUES (
        ${planId}::uuid, ${versionId}::uuid, ${studentId}::uuid, ${parentId}::uuid,
        '2026-01-01', 'default', ${scheduledAt}::timestamptz, 'pending', 'plan',
        ${occurrenceKey}
      )
    `);

    await expectConstraintFailure(
      db,
      sql`
        INSERT INTO schedule_items (
          plan_id, plan_version_id, student_id, owner_id, family_date, slot_key,
          scheduled_at, status, source, occurrence_key
        ) VALUES (
          ${planId}::uuid, ${versionId}::uuid, ${studentId}::uuid, ${parentId}::uuid,
          '2026-01-02', 'default', ${scheduledAt}::timestamptz, 'pending', 'plan',
          ${occurrenceKey}
        )
      `,
      { code: "23505", constraint: "schedule_items_occurrence_key_unique" },
    );
  });

  it("isolates schedule item status CHECK and event CHECK positive/negative paths", async () => {
    const checks = await getCheckConstraintDefs(db, "schedule_events");
    expect(checks.has("schedule_events_from_status_check")).toBe(true);
    expect(checks.get("schedule_events_from_status_check")).toContain("from_status");
    expect(checks.get("schedule_events_from_status_check")).toContain("pending");

    expect(checks.has("schedule_events_to_status_check")).toBe(true);
    expect(checks.get("schedule_events_to_status_check")).toContain("to_status");
    expect(checks.get("schedule_events_to_status_check")).toContain("completed");
    expect(checks.get("schedule_events_to_status_check")).toContain("skipped");

    expect(checks.has("schedule_events_completion_reason_check")).toBe(true);
    const completionCheck = checks.get("schedule_events_completion_reason_check")!;
    expect(completionCheck).toContain("completion_kind");
    expect(completionCheck).toContain("reason IS NULL");
    expect(completionCheck).toContain("skipped");

    const { parentId, studentId } = await seedParentStudent(db);
    const { planId, versionId } = await seedFormalPlan(db, { parentId, studentId, key: "events" });
    const itemId = await seedScheduleItem(db, {
      planId,
      versionId,
      studentId,
      parentId,
      key: "events",
    });
    const occurredAt = new Date("2026-01-01T13:00:00.000Z").toISOString();

    await expectConstraintFailure(
      db,
      sql`
        INSERT INTO schedule_items (
          plan_id, plan_version_id, student_id, owner_id, family_date, slot_key,
          scheduled_at, status, source, occurrence_key
        ) VALUES (
          ${planId}::uuid, ${versionId}::uuid, ${studentId}::uuid, ${parentId}::uuid,
          '2026-01-02', 'default', ${occurredAt}::timestamptz, 'done', 'plan', 'occ-bad-status'
        )
      `,
      { code: "23514", constraint: "schedule_items_status_check" },
    );

    await db.execute(sql`
      INSERT INTO schedule_events (
        schedule_item_id, actor_id, from_status, to_status, idempotency_key,
        idempotency_payload_hash, completion_kind, reason, occurred_at
      ) VALUES
        (${itemId}::uuid, ${parentId}::uuid, 'pending', 'completed', 'complete-on-time', 'hash', 'on_time', NULL, ${occurredAt}::timestamptz),
        (${itemId}::uuid, ${parentId}::uuid, 'pending', 'completed', 'complete-late', 'hash', 'late', NULL, ${occurredAt}::timestamptz),
        (${itemId}::uuid, ${parentId}::uuid, 'pending', 'skipped', 'skip-null-reason', 'hash', NULL, NULL, ${occurredAt}::timestamptz),
        (${itemId}::uuid, ${parentId}::uuid, 'pending', 'skipped', 'skip-with-reason', 'hash', NULL, 'family trip', ${occurredAt}::timestamptz)
    `);

    await expectConstraintFailure(
      db,
      sql`
        INSERT INTO schedule_events (
          schedule_item_id, actor_id, from_status, to_status, idempotency_key,
          idempotency_payload_hash, completion_kind, reason, occurred_at
        ) VALUES (
          ${itemId}::uuid, ${parentId}::uuid, 'completed', 'completed', 'from-not-pending', 'hash',
          'on_time', NULL, ${occurredAt}::timestamptz
        )
      `,
      { code: "23514", constraint: "schedule_events_from_status_check" },
    );
    await expectConstraintFailureOneOf(
      db,
      sql`
        INSERT INTO schedule_events (
          schedule_item_id, actor_id, from_status, to_status, idempotency_key,
          idempotency_payload_hash, completion_kind, reason, occurred_at
        ) VALUES (
          ${itemId}::uuid, ${parentId}::uuid, 'pending', 'expired', 'to-not-terminal-pair', 'hash',
          NULL, NULL, ${occurredAt}::timestamptz
        )
      `,
      {
        code: "23514",
        constraints: ["schedule_events_to_status_check", "schedule_events_completion_reason_check"],
      },
    );
    await expectConstraintFailure(
      db,
      sql`
        INSERT INTO schedule_events (
          schedule_item_id, actor_id, from_status, to_status, idempotency_key,
          idempotency_payload_hash, completion_kind, reason, occurred_at
        ) VALUES (
          ${itemId}::uuid, ${parentId}::uuid, 'pending', 'completed', 'complete-null-kind', 'hash',
          NULL, NULL, ${occurredAt}::timestamptz
        )
      `,
      { code: "23514", constraint: "schedule_events_completion_reason_check" },
    );
    await expectConstraintFailure(
      db,
      sql`
        INSERT INTO schedule_events (
          schedule_item_id, actor_id, from_status, to_status, idempotency_key,
          idempotency_payload_hash, completion_kind, reason, occurred_at
        ) VALUES (
          ${itemId}::uuid, ${parentId}::uuid, 'pending', 'completed', 'complete-bad-kind', 'hash',
          'early', NULL, ${occurredAt}::timestamptz
        )
      `,
      { code: "23514", constraint: "schedule_events_completion_reason_check" },
    );
    await expectConstraintFailure(
      db,
      sql`
        INSERT INTO schedule_events (
          schedule_item_id, actor_id, from_status, to_status, idempotency_key,
          idempotency_payload_hash, completion_kind, reason, occurred_at
        ) VALUES (
          ${itemId}::uuid, ${parentId}::uuid, 'pending', 'completed', 'complete-with-reason', 'hash',
          'on_time', 'should be null', ${occurredAt}::timestamptz
        )
      `,
      { code: "23514", constraint: "schedule_events_completion_reason_check" },
    );
    await expectConstraintFailure(
      db,
      sql`
        INSERT INTO schedule_events (
          schedule_item_id, actor_id, from_status, to_status, idempotency_key,
          idempotency_payload_hash, completion_kind, reason, occurred_at
        ) VALUES (
          ${itemId}::uuid, ${parentId}::uuid, 'pending', 'skipped', 'skip-with-kind', 'hash',
          'on_time', NULL, ${occurredAt}::timestamptz
        )
      `,
      { code: "23514", constraint: "schedule_events_completion_reason_check" },
    );
    await expectConstraintFailure(
      db,
      sql`
        INSERT INTO schedule_events (
          schedule_item_id, actor_id, from_status, to_status, idempotency_key,
          idempotency_payload_hash, completion_kind, reason, occurred_at
        ) VALUES (
          ${itemId}::uuid, ${parentId}::uuid, 'pending', 'completed', 'complete-on-time', 'hash-other',
          'late', NULL, ${occurredAt}::timestamptz
        )
      `,
      { code: "23505", constraint: "schedule_events_item_idempotency_unique" },
    );
  });

  it("enforces fact_versions NOT NULL, completion CHECK, unique key, and nullable audit columns", async () => {
    const { parentId, studentId } = await seedParentStudent(db);
    const { planId, versionId } = await seedFormalPlan(db, { parentId, studentId, key: "facts" });
    const itemId = await seedScheduleItem(db, {
      planId,
      versionId,
      studentId,
      parentId,
      key: "facts",
    });
    const ts = new Date("2026-01-01T13:00:00.000Z").toISOString();

    await expectConstraintFailure(
      db,
      sql`
        INSERT INTO fact_versions (
          schedule_item_id, student_id, fact_key, source_kind, value,
          idempotency_key, idempotency_payload_hash, completion_kind,
          occurred_at, asserted_at, recorded_at
        ) VALUES (
          NULL, ${studentId}::uuid, 'schedule.completed', 'system', '{"completion_kind":"on_time"}'::jsonb,
          'fact-null-item', 'hash', 'on_time', ${ts}::timestamptz, ${ts}::timestamptz, ${ts}::timestamptz
        )
      `,
      { code: "23514", constraint: "fact_versions_schedule_item_binding_check" },
    );

    await db.execute(sql`
      INSERT INTO fact_versions (
        schedule_item_id, student_id, fact_key, source_kind, value,
        idempotency_key, idempotency_payload_hash, completion_kind,
        occurred_at, asserted_at, recorded_at,
        confirmed_at, confirmed_by, supersedes_fact_version_id, voided_at
      ) VALUES (
        ${itemId}::uuid, ${studentId}::uuid, 'schedule.completed', 'system', '{"completion_kind":"on_time"}'::jsonb,
        'fact-ok', 'hash', 'on_time', ${ts}::timestamptz, ${ts}::timestamptz, ${ts}::timestamptz,
        NULL, NULL, NULL, NULL
      )
    `);
    await expectConstraintFailure(
      db,
      sql`
        INSERT INTO fact_versions (
          schedule_item_id, student_id, fact_key, source_kind, value,
          idempotency_key, idempotency_payload_hash, completion_kind,
          occurred_at, asserted_at, recorded_at
        ) VALUES (
          ${itemId}::uuid, ${studentId}::uuid, 'schedule.completed', 'system', '{"completion_kind":"on_time"}'::jsonb,
          'fact-ok', 'hash-other', 'late', ${ts}::timestamptz, ${ts}::timestamptz, ${ts}::timestamptz
        )
      `,
      { code: "23505", constraint: "fact_versions_schedule_item_idempotency_unique" },
    );
    await expectConstraintFailure(
      db,
      sql`
        INSERT INTO fact_versions (
          schedule_item_id, student_id, fact_key, source_kind, value,
          idempotency_key, idempotency_payload_hash, completion_kind,
          occurred_at, asserted_at, recorded_at
        ) VALUES (
          ${itemId}::uuid, ${studentId}::uuid, 'schedule.completed', 'system', '{"completion_kind":"early"}'::jsonb,
          'fact-bad-kind', 'hash', 'early', ${ts}::timestamptz, ${ts}::timestamptz, ${ts}::timestamptz
        )
      `,
      { code: "23514", constraint: "fact_versions_completion_kind_check" },
    );
  });

  it("isolates point_rules uniques and point_rule_versions unique/status CHECK", async () => {
    const { parentId, studentId } = await seedParentStudent(db);
    const now = new Date().toISOString();

    const first = await db.execute(sql`
      INSERT INTO point_rules (
        student_id, creator_parent_id, template_id, active,
        create_idempotency_key, create_idempotency_payload_hash, created_at
      ) VALUES (
        ${studentId}::uuid, ${parentId}::uuid, 'schedule_system_complete_v1', false,
        'rule-key-1', 'hash-rule-1', ${now}::timestamptz
      )
      RETURNING id
    `);
    const pointRuleId = (first[0] as { id: string }).id;

    await expectConstraintFailure(
      db,
      sql`
        INSERT INTO point_rules (
          student_id, creator_parent_id, template_id, active,
          create_idempotency_key, create_idempotency_payload_hash, created_at
        ) VALUES (
          ${studentId}::uuid, ${parentId}::uuid, 'schedule_system_complete_v1', false,
          'rule-key-1', 'hash-rule-1-dup', ${now}::timestamptz
        )
      `,
      { code: "23505", constraint: "point_rules_creator_student_create_idempotency_unique" },
    );

    await db.execute(sql`
      UPDATE point_rules SET active = true WHERE id = ${pointRuleId}::uuid
    `);
    await expectConstraintFailure(
      db,
      sql`
        INSERT INTO point_rules (
          student_id, creator_parent_id, template_id, active,
          create_idempotency_key, create_idempotency_payload_hash, created_at
        ) VALUES (
          ${studentId}::uuid, ${parentId}::uuid, 'schedule_system_complete_v1', true,
          'rule-key-2', 'hash-rule-2', ${now}::timestamptz
        )
      `,
      { code: "23505", constraint: "point_rules_active_student_template_unique" },
    );

    await db.execute(sql`
      INSERT INTO point_rule_versions (
        point_rule_id, version, parameters, effect, priority, effective_at, status
      ) VALUES (
        ${pointRuleId}::uuid, 1, '{}'::jsonb, '{"amount":10}'::jsonb, NULL, ${now}::timestamptz, 'active'
      )
    `);
    await expectConstraintFailure(
      db,
      sql`
        INSERT INTO point_rule_versions (
          point_rule_id, version, parameters, effect, effective_at, status
        ) VALUES (
          ${pointRuleId}::uuid, 1, '{}'::jsonb, '{"amount":10}'::jsonb, ${now}::timestamptz, 'superseded'
        )
      `,
      { code: "23505", constraint: "point_rule_versions_rule_version_unique" },
    );
    await expectConstraintFailure(
      db,
      sql`
        INSERT INTO point_rule_versions (
          point_rule_id, version, parameters, effect, effective_at, status
        ) VALUES (
          ${pointRuleId}::uuid, 2, '{}'::jsonb, '{"amount":10}'::jsonb, ${now}::timestamptz, 'draft'
        )
      `,
      { code: "23514", constraint: "point_rule_versions_status_check" },
    );
  });

  it("isolates settlements unique/result CHECK, horizon unique, and ledger constraints", async () => {
    const graph = await seedSettlementGraph(db, 3);
    const ts = new Date("2026-01-01T13:00:00.000Z").toISOString();
    const [settlementA, settlementB, settlementC] = graph.settlements;

    await expectConstraintFailure(
      db,
      sql`
        INSERT INTO settlements (
          student_id, fact_version_id, rule_version_id, settlement_period,
          result, explanation, idempotency_key
        ) VALUES (
          ${graph.studentId}::uuid, ${graph.facts[0]}::uuid, ${graph.ruleVersionId}::uuid, '2026-01-01',
          'reward', 'dup period', 'dup-settlement'
        )
      `,
      { code: "23505", constraint: "settlements_fact_rule_period_unique" },
    );
    await expectConstraintFailure(
      db,
      sql`
        INSERT INTO settlements (
          student_id, fact_version_id, rule_version_id, settlement_period,
          result, explanation, idempotency_key
        ) VALUES (
          ${graph.studentId}::uuid, ${graph.facts[1]}::uuid, ${graph.ruleVersionId}::uuid, '2026-01-02',
          'penalty', 'bad result', 'bad-result'
        )
      `,
      { code: "23514", constraint: "settlements_result_check" },
    );

    await db.execute(sql`
      INSERT INTO schedule_horizon_maintains (
        student_id, actor_id, idempotency_key, idempotency_payload_hash, items_created, created_at
      ) VALUES (
        ${graph.studentId}::uuid, ${graph.parentId}::uuid, 'horizon-1', 'hash', 0, ${ts}::timestamptz
      )
    `);
    await expectConstraintFailure(
      db,
      sql`
        INSERT INTO schedule_horizon_maintains (
          student_id, actor_id, idempotency_key, idempotency_payload_hash, items_created, created_at
        ) VALUES (
          ${graph.studentId}::uuid, ${graph.parentId}::uuid, 'horizon-1', 'hash-other', 1, ${ts}::timestamptz
        )
      `,
      { code: "23505", constraint: "schedule_horizon_maintains_student_actor_idempotency_unique" },
    );

    const sourceFk = await foreignKeyTarget(db, "point_ledger_entries", "source_id");
    const settlementFk = await foreignKeyTarget(db, "point_ledger_entries", "settlement_id");
    expect(sourceFk.table).toBe("settlements");
    expect(settlementFk.table).toBe("settlements");

    await db.execute(sql`
      INSERT INTO point_ledger_entries (
        student_id, settlement_id, amount, reason, source_type, explanation, source_id,
        reverses_entry_id, created_by, idempotency_key
      ) VALUES (
        ${graph.studentId}::uuid, ${settlementA}::uuid, 10, 'schedule.completed', 'settlement',
        'reward +10', ${settlementA}::uuid, NULL, NULL, 'shared-ledger-key'
      )
    `);

    await expectConstraintFailure(
      db,
      sql`
        INSERT INTO point_ledger_entries (
          student_id, settlement_id, amount, reason, source_type, explanation, source_id, idempotency_key
        ) VALUES (
          ${graph.studentId}::uuid, NULL, 10, 'schedule.completed', 'settlement',
          'null settlement', ${settlementB}::uuid, 'ledger-null-settlement'
        )
      `,
      { code: "23502", column: "settlement_id" },
    );
    await expectConstraintFailure(
      db,
      sql`
        INSERT INTO point_ledger_entries (
          student_id, settlement_id, amount, reason, source_type, explanation, source_id, idempotency_key
        ) VALUES (
          ${graph.studentId}::uuid, ${settlementB}::uuid, 10, 'schedule.completed', 'manual',
          'bad source_type', ${settlementB}::uuid, 'ledger-bad-type'
        )
      `,
      { code: "23514", constraint: "point_ledger_entries_source_check" },
    );
    await expectConstraintFailure(
      db,
      sql`
        INSERT INTO point_ledger_entries (
          student_id, settlement_id, amount, reason, source_type, explanation, source_id, idempotency_key
        ) VALUES (
          ${graph.studentId}::uuid, ${settlementB}::uuid, 10, 'schedule.completed', 'settlement',
          'mismatched settlements', ${settlementC}::uuid, 'ledger-mismatch'
        )
      `,
      { code: "23514", constraint: "point_ledger_entries_source_check" },
    );
    await expectConstraintFailure(
      db,
      sql`
        INSERT INTO point_ledger_entries (
          student_id, settlement_id, amount, reason, source_type, explanation, source_id, idempotency_key
        ) VALUES (
          ${graph.studentId}::uuid, ${settlementB}::uuid, 10, 'schedule.completed', 'settlement',
          'missing source_id', ${MISSING_UUID}::uuid, 'ledger-missing-source'
        )
      `,
      { code: "23514", constraint: "point_ledger_entries_source_check" },
    );
    await expectConstraintFailure(
      db,
      sql`
        INSERT INTO point_ledger_entries (
          student_id, settlement_id, amount, reason, source_type, explanation, source_id, idempotency_key
        ) VALUES (
          ${graph.studentId}::uuid, ${MISSING_UUID}::uuid, 10, 'schedule.completed', 'settlement',
          'missing settlement_id', ${MISSING_UUID}::uuid, 'ledger-missing-settlement'
        )
      `,
      { code: "23503", constraint: settlementFk.constraint },
    );
    await expectConstraintFailure(
      db,
      sql`
        INSERT INTO point_ledger_entries (
          student_id, settlement_id, amount, reason, source_type, explanation, source_id, idempotency_key
        ) VALUES (
          ${graph.studentId}::uuid, ${settlementA}::uuid, 10, 'schedule.completed', 'settlement',
          'dup settlement', ${settlementA}::uuid, 'ledger-dup-settlement'
        )
      `,
      { code: "23505", constraint: "point_ledger_entries_settlement_id_unique" },
    );

    await db.execute(sql`
      INSERT INTO point_ledger_entries (
        student_id, settlement_id, amount, reason, source_type, explanation, source_id,
        reverses_entry_id, created_by, idempotency_key
      ) VALUES (
        ${graph.studentId}::uuid, ${settlementB}::uuid, 10, 'schedule.completed', 'settlement',
        'second +10', ${settlementB}::uuid, NULL, NULL, 'shared-ledger-key'
      )
    `);
  });

  it("applies balance UPSERT on the second ledger and keeps projection PK/FK", async () => {
    const graph = await seedSettlementGraph(db, 2);
    const now = new Date().toISOString();
    const lastFk = await foreignKeyTarget(db, "point_balance_projection", "last_ledger_entry_id");
    expect(lastFk.table).toBe("point_ledger_entries");

    const ledger1Rows = await db.execute(sql`
      INSERT INTO point_ledger_entries (
        student_id, settlement_id, amount, reason, source_type, explanation, source_id,
        reverses_entry_id, created_by, idempotency_key
      ) VALUES (
        ${graph.studentId}::uuid, ${graph.settlements[0]}::uuid, 10, 'schedule.completed', 'settlement',
        'first +10', ${graph.settlements[0]}::uuid, NULL, NULL, 'balance-1'
      )
      RETURNING id
    `);
    const ledger1 = (ledger1Rows[0] as { id: string }).id;
    const ledger2Rows = await db.execute(sql`
      INSERT INTO point_ledger_entries (
        student_id, settlement_id, amount, reason, source_type, explanation, source_id,
        reverses_entry_id, created_by, idempotency_key
      ) VALUES (
        ${graph.studentId}::uuid, ${graph.settlements[1]}::uuid, 10, 'schedule.completed', 'settlement',
        'second +10', ${graph.settlements[1]}::uuid, NULL, NULL, 'balance-2'
      )
      RETURNING id
    `);
    const ledger2 = (ledger2Rows[0] as { id: string }).id;

    await db.execute(sql`
      INSERT INTO point_balance_projection (student_id, balance, last_ledger_entry_id, updated_at)
      VALUES (${graph.studentId}::uuid, 10, ${ledger1}::uuid, ${now}::timestamptz)
    `);
    await db.execute(sql`
      INSERT INTO point_balance_projection (student_id, balance, last_ledger_entry_id, updated_at)
      VALUES (${graph.studentId}::uuid, 10, ${ledger2}::uuid, ${now}::timestamptz)
      ON CONFLICT (student_id) DO UPDATE SET
        balance = point_balance_projection.balance + EXCLUDED.balance,
        last_ledger_entry_id = EXCLUDED.last_ledger_entry_id,
        updated_at = now()
    `);

    const projection = (
      await db.execute(sql`
        SELECT balance, last_ledger_entry_id FROM point_balance_projection
        WHERE student_id = ${graph.studentId}::uuid
      `)
    )[0] as { balance: number; last_ledger_entry_id: string };
    expect(projection.balance).toBe(20);
    expect(projection.last_ledger_entry_id).toBe(ledger2);

    const pkRows = await db.execute(sql`
      SELECT a.attname AS column_name
      FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = 'point_balance_projection'::regclass AND i.indisprimary
    `);
    expect(
      (pkRows as unknown as { column_name: string }[]).map((row) => row.column_name),
    ).toContain("student_id");

    await expectConstraintFailure(
      db,
      sql`
        INSERT INTO point_balance_projection (student_id, balance, last_ledger_entry_id, updated_at)
        VALUES (${graph.parentId}::uuid, 0, ${MISSING_UUID}::uuid, ${now}::timestamptz)
      `,
      { code: "23503", constraint: lastFk.constraint },
    );
  });

  it("migrates an empty database from 0000 through 0013", async () => {
    await withTempDatabase("bd_m2_empty", async (databaseUrl) => {
      await migrateFolder(databaseUrl, "./src/db/migrations");
      await assertMigratedHead(databaseUrl);
    });
  }, 120_000);

  it("upgrades a main/0007 database through 0008-0013", async () => {
    const folder0007 = writeMainThrough0007Folder();
    try {
      await withTempDatabase("bd_m2_from0007", async (databaseUrl) => {
        await migrateFolder(databaseUrl, folder0007);
        const client = postgres(databaseUrl, { max: 1 });
        try {
          const applied = await drizzle(client).execute(
            sql`SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations`,
          );
          expect((applied[0] as { count: number }).count).toBe(8);
          const m2Missing = await drizzle(client).execute(sql`
              SELECT 1 FROM information_schema.tables
              WHERE table_schema = 'public' AND table_name = 'plans'
            `);
          expect(m2Missing).toHaveLength(0);
        } finally {
          await client.end({ timeout: 5 });
        }
        await migrateFolder(databaseUrl, "./src/db/migrations");
        await assertMigratedHead(databaseUrl);
      });
    } finally {
      rmSync(folder0007, { recursive: true, force: true });
    }
  }, 120_000);
});
