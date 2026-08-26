import { config } from "dotenv";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { bootstrapVerifiedParentWithInvite, seedStudentUser } from "../../helpers/family-access";
import { closeTestDb, getTestDb, migrateTestDb, type TestDb } from "../../helpers/db";

config({ path: ".env.local" });
config({ path: ".env" });

const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);

type ColumnRow = { column_name: string };
type ForeignKeyRow = { foreign_table_name: string; column_name: string };
type IndexRow = { indexname: string; indexdef: string };

async function listColumns(db: TestDb, tableName: string): Promise<string[]> {
  const rows = await db.execute(sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${tableName}
    ORDER BY column_name
  `);
  return (rows as unknown as ColumnRow[]).map((row) => row.column_name);
}

async function foreignKeyTarget(
  db: TestDb,
  tableName: string,
  columnName: string,
): Promise<string | undefined> {
  const rows = await db.execute(sql`
    SELECT ccu.table_name AS foreign_table_name, kcu.column_name
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
  const match = (rows as unknown as ForeignKeyRow[])[0];
  return match?.foreign_table_name;
}

async function expectSqlFailure(db: TestDb, statement: ReturnType<typeof sql>): Promise<void> {
  await expect(db.execute(statement)).rejects.toThrow();
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

async function seedFormalPlan(
  db: TestDb,
  input: { parentId: string; studentId: string; key: string },
) {
  const now = new Date().toISOString();
  const payloadHash = `hash-${input.key}`;
  const planRows = await db.execute(sql`
    INSERT INTO plans (
      student_id, owner_id, plan_kind, status, title, start_date,
      create_idempotency_key, create_idempotency_payload_hash
    ) VALUES (
      ${input.studentId}::uuid, ${input.parentId}::uuid, 'formal', 'active', 'Test Plan', '2026-01-01',
      ${input.key}, ${payloadHash}
    )
    RETURNING id
  `);
  const planId = (planRows[0] as { id: string }).id;

  const versionKey = `v1-${input.key}`;
  const versionRows = await db.execute(sql`
    INSERT INTO plan_versions (
      plan_id, version, schedule_rule, effective_from, created_at,
      create_idempotency_key, create_idempotency_payload_hash
    ) VALUES (
      ${planId}::uuid, 1, '{"frequency":"daily"}'::jsonb, '2026-01-01', ${now}::timestamptz,
      ${versionKey}, ${`hash-${versionKey}`}
    )
    RETURNING id
  `);
  const versionId = (versionRows[0] as { id: string }).id;

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

describe.skipIf(!hasDb)("m2 schema constraints", () => {
  const db = getTestDb();

  beforeAll(async () => {
    await migrateTestDb();
  });

  beforeEach(async () => {
    await resetM2Tables(db);
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("exposes data-model §2.0.7 required columns including fact_versions.source_kind/value", async () => {
    const required: Record<string, string[]> = {
      plans: [
        "student_id",
        "owner_id",
        "plan_kind",
        "status",
        "current_version",
        "title",
        "start_date",
        "create_idempotency_key",
        "create_idempotency_payload_hash",
      ],
      plan_versions: [
        "version",
        "schedule_rule",
        "effective_from",
        "effective_until",
        "created_at",
        "create_idempotency_key",
        "create_idempotency_payload_hash",
      ],
      plan_schedule_slots: ["plan_version_id", "slot_key", "local_time"],
      schedule_items: [
        "owner_id",
        "slot_key",
        "source",
        "occurrence_key",
        "plan_snapshot",
        "family_date",
        "scheduled_at",
        "status",
      ],
      schedule_events: [
        "from_status",
        "to_status",
        "actor_id",
        "occurred_at",
        "idempotency_key",
        "idempotency_payload_hash",
        "completion_kind",
        "reason",
      ],
      fact_versions: [
        "fact_key",
        "source_kind",
        "value",
        "occurred_at",
        "asserted_at",
        "recorded_at",
        "schedule_item_id",
        "idempotency_key",
        "idempotency_payload_hash",
        "completion_kind",
      ],
      point_rule_templates: [
        "event_type",
        "parameter_schema",
        "effect_schema",
        "negative_effect_schema",
        "stacking_mode",
        "limits",
        "active",
      ],
      point_rules: [
        "student_id",
        "creator_parent_id",
        "template_id",
        "active",
        "create_idempotency_key",
      ],
      point_rule_versions: [
        "version",
        "parameters",
        "effect",
        "effective_at",
        "priority",
        "status",
      ],
      settlements: ["settlement_period", "result", "explanation", "idempotency_key"],
      point_ledger_entries: [
        "amount",
        "reason",
        "source_type",
        "idempotency_key",
        "settlement_id",
        "source_id",
        "explanation",
      ],
      point_balance_projection: ["balance", "last_ledger_entry_id", "updated_at"],
    };

    for (const [table, columns] of Object.entries(required)) {
      const actual = await listColumns(db, table);
      for (const column of columns) {
        expect(actual, `${table}.${column}`).toContain(column);
      }
    }
  });

  it("uses plans.current_version (not current_version_id) with FK to plan_versions", async () => {
    const columns = await listColumns(db, "plans");
    expect(columns).toContain("current_version");
    expect(columns).not.toContain("current_version_id");
    expect(await foreignKeyTarget(db, "plans", "current_version")).toBe("plan_versions");
  });

  it("enforces plans.goal_id FK to goals and rejects invalid goal_id", async () => {
    expect(await foreignKeyTarget(db, "plans", "goal_id")).toBe("goals");

    const { parentId, studentId } = await seedParentStudent(db);
    await expectSqlFailure(
      db,
      sql`
        INSERT INTO plans (
          student_id, owner_id, goal_id, plan_kind, status, title, start_date,
          create_idempotency_key, create_idempotency_payload_hash
        ) VALUES (
          ${studentId}::uuid, ${parentId}::uuid, ${"00000000-0000-0000-0000-000000000099"}::uuid,
          'formal', 'active', 'Bad Goal Plan', '2026-01-01', 'goal-fk-key', 'hash'
        )
      `,
    );
  });

  it("enforces UNIQUE (plan_id, version) per plan and allows same version across plans", async () => {
    const { parentId, studentId: studentA } = await seedParentStudent(db);
    const { studentId: studentB } = await seedStudentUser(db, {
      username: `student_b_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });

    const planA = await seedFormalPlan(db, { parentId, studentId: studentA, key: "plan-a" });
    const planB = await seedFormalPlan(db, { parentId, studentId: studentB, key: "plan-b" });

    await expectSqlFailure(
      db,
      sql`
        INSERT INTO plan_versions (
          plan_id, version, schedule_rule, effective_from, created_at,
          create_idempotency_key, create_idempotency_payload_hash
        ) VALUES (
          ${planA.planId}::uuid, 1, '{"frequency":"daily"}'::jsonb, '2026-01-02', ${new Date().toISOString()}::timestamptz,
          'dup-version-a', 'hash-dup-version-a'
        )
      `,
    );

    const crossPlanRows = await db.execute(sql`
      SELECT plan_id, version
      FROM plan_versions
      WHERE plan_id IN (${planA.planId}::uuid, ${planB.planId}::uuid) AND version = 1
    `);
    expect(crossPlanRows).toHaveLength(2);
  });

  it("enforces partial UNIQUE for one active formal plan per student", async () => {
    const { parentId, studentId } = await seedParentStudent(db);
    await seedFormalPlan(db, { parentId, studentId, key: "formal-1" });

    await expectSqlFailure(
      db,
      sql`
        INSERT INTO plans (
          student_id, owner_id, plan_kind, status, title, start_date,
          create_idempotency_key, create_idempotency_payload_hash
        ) VALUES (
          ${studentId}::uuid, ${parentId}::uuid, 'formal', 'active', 'Second Formal', '2026-02-01',
          'formal-2', 'hash-formal-2'
        )
      `,
    );
  });

  it("enforces schedule_events composite CHECK for complete vs skip reason", async () => {
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

    await db.execute(sql`
      INSERT INTO schedule_events (
        schedule_item_id, actor_id, from_status, to_status, idempotency_key,
        idempotency_payload_hash, completion_kind, reason, occurred_at
      ) VALUES (
        ${itemId}::uuid, ${parentId}::uuid, 'pending', 'completed', 'complete-ok', 'hash',
        'on_time', NULL, ${occurredAt}::timestamptz
      )
    `);

    await db.execute(sql`
      INSERT INTO schedule_events (
        schedule_item_id, actor_id, from_status, to_status, idempotency_key,
        idempotency_payload_hash, completion_kind, reason, occurred_at
      ) VALUES (
        ${itemId}::uuid, ${parentId}::uuid, 'pending', 'skipped', 'skip-reason', 'hash',
        NULL, 'family trip', ${occurredAt}::timestamptz
      )
    `);

    await expectSqlFailure(
      db,
      sql`
        INSERT INTO schedule_events (
          schedule_item_id, actor_id, from_status, to_status, idempotency_key,
          idempotency_payload_hash, completion_kind, reason, occurred_at
        ) VALUES (
          ${itemId}::uuid, ${parentId}::uuid, 'pending', 'completed', 'complete-bad-reason', 'hash',
          'late', 'should be null', ${occurredAt}::timestamptz
        )
      `,
    );
  });

  it("requires fact_versions.schedule_item_id NOT NULL and allows M2 nullable audit columns", async () => {
    const columns = await listColumns(db, "fact_versions");
    expect(columns).toContain("confirmed_at");
    expect(columns).toContain("confirmed_by");
    expect(columns).toContain("supersedes_fact_version_id");
    expect(columns).toContain("voided_at");

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

    await expectSqlFailure(
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
  });

  it("enforces point_rules idempotency and active partial UNIQUE per student", async () => {
    const { parentId, studentId } = await seedParentStudent(db);
    const now = new Date().toISOString();

    await db.execute(sql`
      INSERT INTO point_rules (
        student_id, creator_parent_id, template_id, active,
        create_idempotency_key, create_idempotency_payload_hash, created_at
      ) VALUES (
        ${studentId}::uuid, ${parentId}::uuid, 'schedule_system_complete_v1', true,
        'rule-key-1', 'hash-rule-1', ${now}::timestamptz
      )
    `);

    await expectSqlFailure(
      db,
      sql`
        INSERT INTO point_rules (
          student_id, creator_parent_id, template_id, active,
          create_idempotency_key, create_idempotency_payload_hash, created_at
        ) VALUES (
          ${studentId}::uuid, ${parentId}::uuid, 'schedule_system_complete_v1', true,
          'rule-key-1', 'hash-rule-1-dup', ${now}::timestamptz
        )
      `,
    );

    await expectSqlFailure(
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
    );
  });

  it("enforces point_ledger_entries settlement_id NOT NULL, source CHECK/FK, and UNIQUE settlement_id", async () => {
    const { parentId, studentId } = await seedParentStudent(db);
    const { planId, versionId } = await seedFormalPlan(db, { parentId, studentId, key: "ledger" });
    const itemId = await seedScheduleItem(db, {
      planId,
      versionId,
      studentId,
      parentId,
      key: "ledger",
    });
    const ts = new Date("2026-01-01T13:00:00.000Z").toISOString();

    const factRows = await db.execute(sql`
      INSERT INTO fact_versions (
        schedule_item_id, student_id, fact_key, source_kind, value,
        idempotency_key, idempotency_payload_hash, completion_kind,
        occurred_at, asserted_at, recorded_at
      ) VALUES (
        ${itemId}::uuid, ${studentId}::uuid, 'schedule.completed', 'system', '{"completion_kind":"on_time"}'::jsonb,
        'ledger-fact', 'hash', 'on_time', ${ts}::timestamptz, ${ts}::timestamptz, ${ts}::timestamptz
      )
      RETURNING id
    `);
    const factVersionId = (factRows[0] as { id: string }).id;

    const ruleRows = await db.execute(sql`
      INSERT INTO point_rules (
        student_id, creator_parent_id, template_id, active,
        create_idempotency_key, create_idempotency_payload_hash, created_at
      ) VALUES (
        ${studentId}::uuid, ${parentId}::uuid, 'schedule_system_complete_v1', true,
        'ledger-rule', 'hash', ${ts}::timestamptz
      )
      RETURNING id
    `);
    const pointRuleId = (ruleRows[0] as { id: string }).id;

    const ruleVersionRows = await db.execute(sql`
      INSERT INTO point_rule_versions (
        point_rule_id, version, parameters, effect, effective_at, status
      ) VALUES (
        ${pointRuleId}::uuid, 1, '{}'::jsonb, '{"amount":10}'::jsonb, ${ts}::timestamptz, 'active'
      )
      RETURNING id
    `);
    const ruleVersionId = (ruleVersionRows[0] as { id: string }).id;

    const settlementRows = await db.execute(sql`
      INSERT INTO settlements (
        student_id, fact_version_id, rule_version_id, settlement_period,
        result, explanation, idempotency_key
      ) VALUES (
        ${studentId}::uuid, ${factVersionId}::uuid, ${ruleVersionId}::uuid, '2026-01-01',
        'reward', 'completed on_time', 'ledger-settlement'
      )
      RETURNING id
    `);
    const settlementId = (settlementRows[0] as { id: string }).id;

    expect(await foreignKeyTarget(db, "point_ledger_entries", "source_id")).toBe("settlements");

    await db.execute(sql`
      INSERT INTO point_ledger_entries (
        student_id, settlement_id, amount, reason, source_type, explanation, source_id,
        reverses_entry_id, created_by, idempotency_key
      ) VALUES (
        ${studentId}::uuid, ${settlementId}::uuid, 10, 'schedule.completed', 'settlement',
        'reward +10', ${settlementId}::uuid, NULL, NULL, 'ledger-entry-1'
      )
    `);

    await expectSqlFailure(
      db,
      sql`
        INSERT INTO point_ledger_entries (
          student_id, settlement_id, amount, reason, source_type, explanation, source_id, idempotency_key
        ) VALUES (
          ${studentId}::uuid, ${settlementId}::uuid, 10, 'schedule.completed', 'manual',
          'bad source_type', ${settlementId}::uuid, 'ledger-entry-2'
        )
      `,
    );

    await expectSqlFailure(
      db,
      sql`
        INSERT INTO point_ledger_entries (
          student_id, settlement_id, amount, reason, source_type, explanation, source_id, idempotency_key
        ) VALUES (
          ${studentId}::uuid, ${settlementId}::uuid, 10, 'schedule.completed', 'settlement',
          'mismatched source_id', ${"00000000-0000-0000-0000-000000000099"}::uuid, 'ledger-entry-3'
        )
      `,
    );

    await expectSqlFailure(
      db,
      sql`
        INSERT INTO point_ledger_entries (
          student_id, settlement_id, amount, reason, source_type, explanation, source_id, idempotency_key
        ) VALUES (
          ${studentId}::uuid, ${settlementId}::uuid, 10, 'schedule.completed', 'settlement',
          'duplicate settlement', ${settlementId}::uuid, 'ledger-entry-dup-settlement'
        )
      `,
    );

    await expectSqlFailure(
      db,
      sql`
        INSERT INTO point_ledger_entries (
          student_id, settlement_id, amount, reason, source_type, explanation, source_id, idempotency_key
        ) VALUES (
          ${studentId}::uuid, ${"00000000-0000-0000-0000-000000000099"}::uuid, 10, 'schedule.completed', 'settlement',
          'invalid settlement fk', ${"00000000-0000-0000-0000-000000000099"}::uuid, 'ledger-entry-bad-fk'
        )
      `,
    );
  });

  it("does not define a global UNIQUE index on point_ledger_entries.idempotency_key", async () => {
    const rows = await db.execute(sql`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'point_ledger_entries'
    `);
    const indexes = rows as unknown as IndexRow[];
    const idempotencyUnique = indexes.filter(
      (row) =>
        row.indexdef.includes("UNIQUE") &&
        row.indexdef.includes("idempotency_key") &&
        !row.indexdef.includes("settlement_id"),
    );
    expect(idempotencyUnique).toHaveLength(0);
    expect(indexes.some((row) => row.indexdef.includes("settlement_id"))).toBe(true);
  });

  it("supports point_balance_projection PK and balance UPSERT via EXCLUDED.balance", async () => {
    const { parentId, studentId } = await seedParentStudent(db);
    const now = new Date().toISOString();
    const suffix = crypto.randomUUID().slice(0, 8);
    const ts = new Date("2026-01-01T14:00:00.000Z").toISOString();

    const { planId, versionId } = await seedFormalPlan(db, {
      parentId,
      studentId,
      key: `balance-${suffix}`,
    });
    const itemId = await seedScheduleItem(db, {
      planId,
      versionId,
      studentId,
      parentId,
      key: `balance-${suffix}`,
    });

    const factRows = await db.execute(sql`
      INSERT INTO fact_versions (
        schedule_item_id, student_id, fact_key, source_kind, value,
        idempotency_key, idempotency_payload_hash, completion_kind,
        occurred_at, asserted_at, recorded_at
      ) VALUES (
        ${itemId}::uuid, ${studentId}::uuid, 'schedule.completed', 'system', '{"completion_kind":"on_time"}'::jsonb,
        ${`balance-fact-${suffix}`}, 'hash', 'on_time', ${ts}::timestamptz, ${ts}::timestamptz, ${ts}::timestamptz
      )
      RETURNING id
    `);
    const factVersionId = (factRows[0] as { id: string }).id;

    const ruleRows = await db.execute(sql`
      INSERT INTO point_rules (
        student_id, creator_parent_id, template_id, active,
        create_idempotency_key, create_idempotency_payload_hash, created_at
      ) VALUES (
        ${studentId}::uuid, ${parentId}::uuid, 'schedule_system_complete_v1', true,
        ${`balance-rule-${suffix}`}, 'hash', ${ts}::timestamptz
      )
      RETURNING id
    `);
    const pointRuleId = (ruleRows[0] as { id: string }).id;

    const ruleVersionRows = await db.execute(sql`
      INSERT INTO point_rule_versions (
        point_rule_id, version, parameters, effect, effective_at, status
      ) VALUES (
        ${pointRuleId}::uuid, 1, '{}'::jsonb, '{"amount":10}'::jsonb, ${ts}::timestamptz, 'active'
      )
      RETURNING id
    `);
    const ruleVersionId = (ruleVersionRows[0] as { id: string }).id;

    const settlementRows = await db.execute(sql`
      INSERT INTO settlements (
        student_id, fact_version_id, rule_version_id, settlement_period,
        result, explanation, idempotency_key
      ) VALUES (
        ${studentId}::uuid, ${factVersionId}::uuid, ${ruleVersionId}::uuid, '2026-01-01',
        'reward', 'balance upsert', ${`balance-settlement-${suffix}`}
      )
      RETURNING id
    `);
    const settlementId = (settlementRows[0] as { id: string }).id;

    const ledgerRows = await db.execute(sql`
      INSERT INTO point_ledger_entries (
        student_id, settlement_id, amount, reason, source_type, explanation, source_id, idempotency_key
      ) VALUES (
        ${studentId}::uuid, ${settlementId}::uuid, 10, 'schedule.completed', 'settlement',
        'first +10', ${settlementId}::uuid, ${`balance-ledger-${suffix}`}
      )
      RETURNING id
    `);
    const ledgerId = (ledgerRows[0] as { id: string }).id;

    await db.execute(sql`
      INSERT INTO point_balance_projection (student_id, balance, last_ledger_entry_id, updated_at)
      VALUES (${studentId}::uuid, 10, ${ledgerId}::uuid, ${now}::timestamptz)
      ON CONFLICT (student_id) DO UPDATE SET
        balance = point_balance_projection.balance + EXCLUDED.balance,
        last_ledger_entry_id = EXCLUDED.last_ledger_entry_id,
        updated_at = now()
    `);

    const projectionRows = await db.execute(sql`
      SELECT balance, last_ledger_entry_id
      FROM point_balance_projection
      WHERE student_id = ${studentId}::uuid
    `);
    const projection = projectionRows[0] as { balance: number; last_ledger_entry_id: string };
    expect(projection.balance).toBe(10);
    expect(projection.last_ledger_entry_id).toBe(ledgerId);

    const pkRows = await db.execute(sql`
      SELECT a.attname AS column_name
      FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = 'point_balance_projection'::regclass AND i.indisprimary
    `);
    const pkColumns = (pkRows as unknown as { column_name: string }[]).map(
      (row) => row.column_name,
    );
    expect(pkColumns).toContain("student_id");

    expect(await foreignKeyTarget(db, "point_balance_projection", "last_ledger_entry_id")).toBe(
      "point_ledger_entries",
    );
  });

  it("allows point_rule_versions.priority and ledger optional columns to be NULL", async () => {
    const columns = await listColumns(db, "point_rule_versions");
    expect(columns).toContain("priority");

    const { parentId, studentId } = await seedParentStudent(db);
    const ts = new Date("2026-01-01T15:00:00.000Z").toISOString();

    const ruleRows = await db.execute(sql`
      INSERT INTO point_rules (
        student_id, creator_parent_id, template_id, active,
        create_idempotency_key, create_idempotency_payload_hash, created_at
      ) VALUES (
        ${studentId}::uuid, ${parentId}::uuid, 'schedule_system_complete_v1', false,
        'priority-null-rule', 'hash', ${ts}::timestamptz
      )
      RETURNING id
    `);
    const pointRuleId = (ruleRows[0] as { id: string }).id;

    await db.execute(sql`
      INSERT INTO point_rule_versions (
        point_rule_id, version, parameters, effect, priority, effective_at, status
      ) VALUES (
        ${pointRuleId}::uuid, 1, '{}'::jsonb, '{"amount":10}'::jsonb, NULL, ${ts}::timestamptz, 'active'
      )
    `);
  });
});
