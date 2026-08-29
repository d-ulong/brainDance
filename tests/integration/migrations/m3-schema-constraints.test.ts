import { readFileSync } from "node:fs";
import path from "node:path";

import { config } from "dotenv";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { FactsError, type FactsErrorCode } from "@/modules/facts/errors";
import { OutboxError, type OutboxErrorCode } from "@/modules/outbox/errors";

import { type TestDb } from "../../helpers/db";
import { bootstrapVerifiedParentWithInvite, seedStudentUser } from "../../helpers/family-access";
import {
  closeIsolatedM2Database,
  openIsolatedM2Database,
  type IsolatedM2Database,
} from "./m2-isolated-database";

config({ path: ".env.local" });
config({ path: ".env" });

const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);

type PgFailure = { code?: string; constraint?: string; column?: string };

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

async function resetM3Tables(db: TestDb): Promise<void> {
  await db.execute(sql`
    TRUNCATE TABLE
      worker_attempts,
      outbox_events,
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
  input: { parentId: string; studentId: string; key: string; status?: string },
) {
  const status = input.status ?? "active";
  const payloadHash = `hash-${input.key}`;
  const rows = await db.execute(sql`
    INSERT INTO plans (
      student_id, owner_id, plan_kind, status, title, start_date,
      create_idempotency_key, create_idempotency_payload_hash
    ) VALUES (
      ${input.studentId}::uuid, ${input.parentId}::uuid, 'formal', ${status}, 'Test Plan', '2026-01-01',
      ${input.key}, ${payloadHash}
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
  input: { parentId: string; studentId: string; key: string },
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

async function insertSystemFact(
  db: TestDb,
  input: { itemId: string; studentId: string; key: string },
) {
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

async function insertManualErrorCountFact(
  db: TestDb,
  input: {
    itemId: string;
    studentId: string;
    submittedBy: string;
    key: string;
    errorCount?: number;
    confirmedBy?: string;
    confirmedAt?: string;
    supersedesId?: string;
    correctionReason?: string;
  },
) {
  const ts = new Date("2026-01-01T13:00:00.000Z").toISOString();
  const errorCount = input.errorCount ?? 2;
  const rows = await db.execute(sql`
    INSERT INTO fact_versions (
      schedule_item_id, student_id, fact_key, source_kind, value,
      idempotency_key, idempotency_payload_hash, completion_kind,
      occurred_at, asserted_at, recorded_at, submitted_by,
      confirmed_at, confirmed_by, supersedes_fact_version_id, correction_reason
    ) VALUES (
      ${input.itemId}::uuid, ${input.studentId}::uuid, 'schedule.error_count', 'manual',
      ${JSON.stringify({ error_count: errorCount })}::jsonb, ${input.key}, 'hash', 'not_applicable',
      ${ts}::timestamptz, ${ts}::timestamptz, ${ts}::timestamptz, ${input.submittedBy}::uuid,
      ${input.confirmedAt ?? null}::timestamptz, ${input.confirmedBy ?? null}::uuid,
      ${input.supersedesId ?? null}::uuid, ${input.correctionReason ?? null}
    )
    RETURNING id
  `);
  return (rows[0] as { id: string }).id;
}

async function seedSettlementGraph(db: TestDb) {
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
  const factId = await insertSystemFact(db, {
    itemId,
    studentId,
    key: `graph-fact-${crypto.randomUUID()}`,
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

  const settlementRows = await db.execute(sql`
    INSERT INTO settlements (
      student_id, fact_version_id, rule_version_id, settlement_period,
      result, explanation, idempotency_key
    ) VALUES (
      ${studentId}::uuid, ${factId}::uuid, ${ruleVersionId}::uuid, '2026-01-01',
      'reward', 'graph settlement', ${`graph-settlement-${crypto.randomUUID()}`}
    )
    RETURNING id
  `);
  const settlementId = (settlementRows[0] as { id: string }).id;

  const ledgerRows = await db.execute(sql`
    INSERT INTO point_ledger_entries (
      student_id, settlement_id, amount, reason, source_type, explanation, source_id,
      reverses_entry_id, created_by, idempotency_key
    ) VALUES (
      ${studentId}::uuid, ${settlementId}::uuid, 10, 'schedule.completed', 'settlement',
      'reward +10', ${settlementId}::uuid, NULL, NULL, ${`ledger-${crypto.randomUUID()}`}
    )
    RETURNING id
  `);

  return {
    parentId,
    studentId,
    itemId,
    factId,
    settlementId,
    ledgerId: (ledgerRows[0] as { id: string }).id,
    ruleVersionId,
  };
}

describe.skipIf(!hasDb)("m3 schema constraints", () => {
  let db: TestDb;
  let isolatedDb: IsolatedM2Database | undefined;

  beforeAll(async () => {
    isolatedDb = await openIsolatedM2Database();
    db = isolatedDb.db;
  }, 120_000);

  beforeEach(async () => {
    await resetM3Tables(db);
  });

  afterAll(async () => {
    if (isolatedDb) {
      await closeIsolatedM2Database(isolatedDb);
    }
  });

  it("P1-01 mirrors migration 0014 through journal head and worker_attempts table", async () => {
    const journal = JSON.parse(
      readFileSync(path.join(process.cwd(), "src/db/migrations/meta/_journal.json"), "utf8"),
    ) as { entries: { tag: string }[] };
    expect(journal.entries.at(-1)?.tag).toBe("0014_m3_ledger_reliability");

    const applied = await db.execute(
      sql`SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations`,
    );
    expect((applied[0] as { count: number }).count).toBe(15);

    const workerTable = await db.execute(sql`
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'worker_attempts'
    `);
    expect(workerTable).toHaveLength(1);

    const outboxColumns = await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'outbox_events'
        AND column_name IN ('leased_until', 'lease_token', 'lease_owner', 'attempts', 'last_error_code')
      ORDER BY column_name
    `);
    expect(
      (outboxColumns as unknown as { column_name: string }[]).map((row) => row.column_name),
    ).toEqual(["attempts", "last_error_code", "lease_owner", "lease_token", "leased_until"]);
  });

  it("P1-02 allows manual error_count facts and preserves system fact invariants", async () => {
    const { parentId, studentId } = await seedParentStudent(db);
    const { planId, versionId } = await seedFormalPlan(db, {
      parentId,
      studentId,
      key: "manual-fact",
    });
    const itemId = await seedScheduleItem(db, {
      planId,
      versionId,
      studentId,
      parentId,
      key: "manual-fact",
    });
    const ts = new Date("2026-01-01T13:00:00.000Z").toISOString();

    const factId = await insertManualErrorCountFact(db, {
      itemId,
      studentId,
      submittedBy: studentId,
      key: "manual-error-count-1",
      errorCount: 0,
    });
    expect(factId).toBeTruthy();

    await insertManualErrorCountFact(db, {
      itemId,
      studentId,
      submittedBy: studentId,
      key: "manual-error-count-confirmed",
      confirmedBy: parentId,
      confirmedAt: ts,
    });

    await expectConstraintFailure(
      db,
      sql`
        INSERT INTO fact_versions (
          schedule_item_id, student_id, fact_key, source_kind, value,
          idempotency_key, idempotency_payload_hash, completion_kind,
          occurred_at, asserted_at, recorded_at, submitted_by
        ) VALUES (
          NULL, ${studentId}::uuid, 'schedule.error_count', 'manual',
          '{"error_count":1}'::jsonb, 'manual-null-item', 'hash', 'not_applicable',
          ${ts}::timestamptz, ${ts}::timestamptz, ${ts}::timestamptz, ${studentId}::uuid
        )
      `,
      { code: "23514", constraint: "fact_versions_manual_invariants_check" },
    );

    await expectConstraintFailure(
      db,
      sql`
        INSERT INTO fact_versions (
          schedule_item_id, student_id, fact_key, source_kind, value,
          idempotency_key, idempotency_payload_hash, completion_kind,
          occurred_at, asserted_at, recorded_at
        ) VALUES (
          ${itemId}::uuid, ${studentId}::uuid, 'schedule.error_count', 'manual',
          '{"error_count":-1}'::jsonb, 'manual-negative', 'hash', 'not_applicable',
          ${ts}::timestamptz, ${ts}::timestamptz, ${ts}::timestamptz
        )
      `,
      { code: "23514", constraint: "fact_versions_manual_invariants_check" },
    );

    await expectConstraintFailure(
      db,
      sql`
        INSERT INTO fact_versions (
          schedule_item_id, student_id, fact_key, source_kind, value,
          idempotency_key, idempotency_payload_hash, completion_kind,
          occurred_at, asserted_at, recorded_at, submitted_by
        ) VALUES (
          ${itemId}::uuid, ${studentId}::uuid, 'schedule.error_count', 'manual',
          '{"error_count":1}'::jsonb, 'manual-no-submitter', 'hash', 'not_applicable',
          ${ts}::timestamptz, ${ts}::timestamptz, ${ts}::timestamptz, NULL
        )
      `,
      { code: "23514", constraint: "fact_versions_manual_invariants_check" },
    );

    await expectConstraintFailure(
      db,
      sql`
        INSERT INTO fact_versions (
          schedule_item_id, student_id, fact_key, source_kind, value,
          idempotency_key, idempotency_payload_hash, completion_kind,
          occurred_at, asserted_at, recorded_at
        ) VALUES (
          NULL, ${studentId}::uuid, 'schedule.completed', 'system',
          '{"completion_kind":"on_time"}'::jsonb, 'system-null-item', 'hash', 'on_time',
          ${ts}::timestamptz, ${ts}::timestamptz, ${ts}::timestamptz
        )
      `,
      { code: "23514", constraint: "fact_versions_schedule_item_binding_check" },
    );
  });

  it("P1-03 enforces successor uniqueness and reversal ledger idempotency", async () => {
    const graph = await seedSettlementGraph(db);
    const ts = new Date("2026-01-01T13:00:00.000Z").toISOString();

    const predecessorId = await insertManualErrorCountFact(db, {
      itemId: graph.itemId,
      studentId: graph.studentId,
      submittedBy: graph.studentId,
      key: "correction-predecessor",
      confirmedBy: graph.parentId,
      confirmedAt: ts,
    });

    await expectConstraintFailure(
      db,
      sql`
        INSERT INTO fact_versions (
          schedule_item_id, student_id, fact_key, source_kind, value,
          idempotency_key, idempotency_payload_hash, completion_kind,
          occurred_at, asserted_at, recorded_at, submitted_by,
          supersedes_fact_version_id
        ) VALUES (
          ${graph.itemId}::uuid, ${graph.studentId}::uuid, 'schedule.error_count', 'manual',
          '{"error_count":4}'::jsonb, 'correction-no-reason', 'hash', 'not_applicable',
          ${ts}::timestamptz, ${ts}::timestamptz, ${ts}::timestamptz, ${graph.studentId}::uuid,
          ${predecessorId}::uuid
        )
      `,
      { code: "23514", constraint: "fact_versions_correction_reason_check" },
    );

    await insertManualErrorCountFact(db, {
      itemId: graph.itemId,
      studentId: graph.studentId,
      submittedBy: graph.studentId,
      key: "correction-successor",
      supersedesId: predecessorId,
      correctionReason: "miscounted errors",
    });

    await expectConstraintFailure(
      db,
      sql`
        INSERT INTO fact_versions (
          schedule_item_id, student_id, fact_key, source_kind, value,
          idempotency_key, idempotency_payload_hash, completion_kind,
          occurred_at, asserted_at, recorded_at, submitted_by,
          supersedes_fact_version_id, correction_reason
        ) VALUES (
          ${graph.itemId}::uuid, ${graph.studentId}::uuid, 'schedule.error_count', 'manual',
          '{"error_count":3}'::jsonb, 'correction-dup-successor', 'hash', 'not_applicable',
          ${ts}::timestamptz, ${ts}::timestamptz, ${ts}::timestamptz, ${graph.studentId}::uuid,
          ${predecessorId}::uuid, 'second successor'
        )
      `,
      { code: "23505", constraint: "fact_versions_supersedes_predecessor_unique" },
    );

    const reversalSettlementRows = await db.execute(sql`
      INSERT INTO settlements (
        student_id, fact_version_id, rule_version_id, settlement_period,
        result, explanation, idempotency_key
      ) VALUES (
        ${graph.studentId}::uuid, ${predecessorId}::uuid, ${graph.ruleVersionId}::uuid, '2026-01-02',
        'reward', 'reversal settlement', ${`reversal-settlement-${crypto.randomUUID()}`}
      )
      RETURNING id
    `);
    const reversalSettlementId = (reversalSettlementRows[0] as { id: string }).id;

    await db.execute(sql`
      INSERT INTO point_ledger_entries (
        student_id, settlement_id, amount, reason, source_type, explanation, source_id,
        reverses_entry_id, created_by, idempotency_key
      ) VALUES (
        ${graph.studentId}::uuid, ${reversalSettlementId}::uuid, -10, 'correction.reversal', 'reversal',
        'reverse prior reward', ${reversalSettlementId}::uuid, ${graph.ledgerId}::uuid, ${graph.parentId}::uuid,
        'correction-reversal-key'
      )
    `);

    const duplicateReversalSettlementRows = await db.execute(sql`
      INSERT INTO settlements (
        student_id, fact_version_id, rule_version_id, settlement_period,
        result, explanation, idempotency_key
      ) VALUES (
        ${graph.studentId}::uuid, ${predecessorId}::uuid, ${graph.ruleVersionId}::uuid, '2026-01-03',
        'reward', 'duplicate reversal settlement', ${`reversal-settlement-dup-${crypto.randomUUID()}`}
      )
      RETURNING id
    `);
    const duplicateReversalSettlementId = (duplicateReversalSettlementRows[0] as { id: string }).id;

    await expectConstraintFailure(
      db,
      sql`
        INSERT INTO point_ledger_entries (
          student_id, settlement_id, amount, reason, source_type, explanation, source_id,
          reverses_entry_id, created_by, idempotency_key
        ) VALUES (
          ${graph.studentId}::uuid, ${duplicateReversalSettlementId}::uuid, -10, 'correction.reversal', 'reversal',
          'duplicate reversal new settlement', ${duplicateReversalSettlementId}::uuid, ${graph.ledgerId}::uuid,
          ${graph.parentId}::uuid, 'correction-reversal-key'
        )
      `,
      { code: "23505", constraint: "point_ledger_entries_reversal_idempotency_unique" },
    );

    await expectConstraintFailure(
      db,
      sql`
        INSERT INTO point_ledger_entries (
          student_id, settlement_id, amount, reason, source_type, explanation, source_id,
          reverses_entry_id, created_by, idempotency_key
        ) VALUES (
          ${graph.studentId}::uuid, ${graph.settlementId}::uuid, 10, 'correction.reversal', 'reversal',
          'positive reversal rejected', ${graph.settlementId}::uuid, ${graph.ledgerId}::uuid, NULL,
          'bad-reversal-amount'
        )
      `,
      { code: "23514", constraint: "point_ledger_entries_source_check" },
    );
  });

  it("P1-04 enforces outbox lifecycle fields and worker_attempts audit shape", async () => {
    const eventRows = await db.execute(sql`
      INSERT INTO outbox_events (
        aggregate_type, aggregate_id, event_type, dedupe_key, payload, status, available_at, created_at
      ) VALUES (
        'fact', gen_random_uuid(), 'fact.correction', ${`dedupe-${crypto.randomUUID()}`},
        '{}'::jsonb, 'pending', now(), now()
      )
      RETURNING id
    `);
    const eventId = (eventRows[0] as { id: string }).id;

    await db.execute(sql`
      UPDATE outbox_events
      SET status = 'leased', leased_until = now() + interval '30 seconds',
          lease_token = gen_random_uuid(), lease_owner = 'worker-1', attempts = 1
      WHERE id = ${eventId}::uuid
    `);

    await expectConstraintFailure(
      db,
      sql`
        INSERT INTO outbox_events (
          aggregate_type, aggregate_id, event_type, dedupe_key, payload, status, available_at, created_at
        ) VALUES (
          'fact', gen_random_uuid(), 'fact.correction', ${`dedupe-bad-${crypto.randomUUID()}`},
          '{}'::jsonb, 'running', now(), now()
        )
      `,
      { code: "23514", constraint: "outbox_events_status_check" },
    );

    await expectConstraintFailure(
      db,
      sql`
        UPDATE outbox_events
        SET status = 'leased', leased_until = NULL, lease_token = NULL, lease_owner = NULL
        WHERE id = ${eventId}::uuid
      `,
      { code: "23514", constraint: "outbox_events_lease_fields_check" },
    );

    await db.execute(sql`
      INSERT INTO worker_attempts (
        outbox_event_id, attempt_number, outcome, started_at, finished_at, error_category, lease_token
      ) VALUES (
        ${eventId}::uuid, 1, 'failure', now(), now(), 'handler_timeout', gen_random_uuid()
      )
    `);

    await expectConstraintFailure(
      db,
      sql`
        INSERT INTO worker_attempts (
          outbox_event_id, attempt_number, outcome, started_at
        ) VALUES (
          ${eventId}::uuid, 1, 'success', now()
        )
      `,
      { code: "23505", constraint: "worker_attempts_outbox_attempt_unique" },
    );

    await expectConstraintFailure(
      db,
      sql`
        INSERT INTO worker_attempts (
          outbox_event_id, attempt_number, outcome, started_at
        ) VALUES (
          ${eventId}::uuid, 2, 'unknown', now()
        )
      `,
      { code: "23514", constraint: "worker_attempts_outcome_check" },
    );

    const claimIndex = await db.execute(sql`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public' AND indexname = 'outbox_events_claim_eligible_idx'
    `);
    expect(claimIndex).toHaveLength(1);

    const deadIndex = await db.execute(sql`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public' AND indexname = 'outbox_events_dead_list_idx'
    `);
    expect(deadIndex).toHaveLength(1);
  });

  it("P1-05 exposes typed facts and outbox domain error contracts", () => {
    const factsCodes: FactsErrorCode[] = [
      "NOT_FOUND",
      "FORBIDDEN",
      "IDEMPOTENCY_CONFLICT",
      "STATE_CONFLICT",
      "VALIDATION_ERROR",
      "WINDOW_EXPIRED",
      "NOT_CONFIRMED",
    ];
    for (const code of factsCodes) {
      const error = new FactsError(code, `facts ${code}`);
      expect(error.name).toBe("FactsError");
      expect(error.code).toBe(code);
    }

    const outboxCodes: OutboxErrorCode[] = [
      "NOT_FOUND",
      "FORBIDDEN",
      "LEASE_MISMATCH",
      "STATE_CONFLICT",
      "IDEMPOTENCY_CONFLICT",
      "MAX_ATTEMPTS_EXCEEDED",
      "UNSUPPORTED_EVENT",
    ];
    for (const code of outboxCodes) {
      const error = new OutboxError(code, `outbox ${code}`);
      expect(error.name).toBe("OutboxError");
      expect(error.code).toBe(code);
    }
  });

  it("P1-06 keeps M2 settlement ledger source check valid for reward entries", async () => {
    const graph = await seedSettlementGraph(db);

    await expectConstraintFailure(
      db,
      sql`
        INSERT INTO point_ledger_entries (
          student_id, settlement_id, amount, reason, source_type, explanation, source_id, idempotency_key
        ) VALUES (
          ${graph.studentId}::uuid, ${graph.settlementId}::uuid, 10, 'schedule.completed', 'manual',
          'bad source_type', ${graph.settlementId}::uuid, 'm2-regression-bad-type'
        )
      `,
      { code: "23514", constraint: "point_ledger_entries_source_check" },
    );
  });
});
