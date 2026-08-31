import { readFileSync } from "node:fs";
import path from "node:path";

import { config } from "dotenv";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

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
      return { code, constraint };
    }
    current = record.cause ?? record.originalError;
  }
  return {};
}

async function expectConstraintFailure(
  executor: { execute: TestDb["execute"] },
  statement: ReturnType<typeof sql>,
  expected: { code: string; constraint?: string },
): Promise<void> {
  try {
    await executor.execute(statement);
    throw new Error(`Expected SQLSTATE ${expected.code} but succeeded`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Expected SQLSTATE")) {
      throw error;
    }
    const failure = unwrapPgFailure(error);
    expect(failure.code).toBe(expected.code);
    if (expected.constraint) {
      expect(failure.constraint).toBe(expected.constraint);
    }
  }
}

async function resetM6Tables(db: TestDb): Promise<void> {
  await db.execute(sql`
    TRUNCATE TABLE
      point_redemptions,
      redemption_catalog_items,
      point_balance_projection,
      point_ledger_entries,
      settlements,
      fact_versions,
      schedule_events,
      schedule_items,
      plans,
      goals,
      relationships,
      family_memberships,
      families,
      users
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
  return { parentId, studentId, suffix };
}

describe.skipIf(!hasDb)("m6 schema constraints", () => {
  let isolated: IsolatedM2Database;

  beforeAll(async () => {
    isolated = await openIsolatedM2Database();
  });

  beforeEach(async () => {
    await resetM6Tables(isolated.db);
  });

  afterAll(async () => {
    await closeIsolatedM2Database(isolated);
  });

  it("journal head includes 0026_m6_data_lifecycle", () => {
    const journal = JSON.parse(
      readFileSync(path.join(process.cwd(), "src/db/migrations/meta/_journal.json"), "utf8"),
    ) as { entries: Array<{ tag: string }> };
    expect(journal.entries.at(-1)?.tag).toBe("0026_m6_data_lifecycle");
  });

  it("rejects non-positive catalog cost", async () => {
    const { parentId, studentId } = await seedParentStudent(isolated.db);
    await expectConstraintFailure(
      isolated.db,
      sql`
        INSERT INTO redemption_catalog_items (
          student_id, creator_parent_id, title, cost, active,
          create_idempotency_key, create_idempotency_payload_hash, created_at, updated_at
        ) VALUES (
          ${parentId}::uuid, ${parentId}::uuid, 'Bad', 0, true,
          'k1', 'h1', now(), now()
        )
      `,
      { code: "23514", constraint: "redemption_catalog_items_cost_check" },
    );
    void studentId;
  });

  it("rejects invalid redemption status", async () => {
    const { parentId, studentId } = await seedParentStudent(isolated.db);
    const rows = await isolated.db.execute(sql`
      INSERT INTO redemption_catalog_items (
        student_id, creator_parent_id, title, cost, active,
        create_idempotency_key, create_idempotency_payload_hash, created_at, updated_at
      ) VALUES (
        ${studentId}::uuid, ${parentId}::uuid, 'Item', 10, true,
        'k1', 'h1', now(), now()
      ) RETURNING id
    `);
    const catalogId = (rows[0] as { id: string }).id;

    await expectConstraintFailure(
      isolated.db,
      sql`
        INSERT INTO point_redemptions (
          student_id, catalog_item_id, cost_snapshot, request_month, status,
          requested_at, create_idempotency_key, create_idempotency_payload_hash, created_at
        ) VALUES (
          ${studentId}::uuid, ${catalogId}::uuid, 10, '2026-01', 'invalid',
          now(), 'r1', 'h1', now()
        )
      `,
      { code: "23514" },
    );
  });

  it("rejects approved redemption without ledger entry", async () => {
    const { parentId, studentId } = await seedParentStudent(isolated.db);
    const rows = await isolated.db.execute(sql`
      INSERT INTO redemption_catalog_items (
        student_id, creator_parent_id, title, cost, active,
        create_idempotency_key, create_idempotency_payload_hash, created_at, updated_at
      ) VALUES (
        ${studentId}::uuid, ${parentId}::uuid, 'Item', 10, true,
        'k1', 'h1', now(), now()
      ) RETURNING id
    `);
    const catalogId = (rows[0] as { id: string }).id;

    await expectConstraintFailure(
      isolated.db,
      sql`
        INSERT INTO point_redemptions (
          student_id, catalog_item_id, cost_snapshot, request_month, status,
          requested_at, confirmed_at, confirmed_by,
          create_idempotency_key, create_idempotency_payload_hash, created_at
        ) VALUES (
          ${studentId}::uuid, ${catalogId}::uuid, 10, '2026-01', 'approved',
          now(), now(), ${parentId}::uuid,
          'r1', 'h1', now()
        )
      `,
      { code: "23514", constraint: "point_redemptions_state_invariants_check" },
    );
  });

  it("rejects duplicate redemption ledger source", async () => {
    const { parentId, studentId } = await seedParentStudent(isolated.db);
    const catRows = await isolated.db.execute(sql`
      INSERT INTO redemption_catalog_items (
        student_id, creator_parent_id, title, cost, active,
        create_idempotency_key, create_idempotency_payload_hash, created_at, updated_at
      ) VALUES (
        ${studentId}::uuid, ${parentId}::uuid, 'Item', 10, true,
        'k1', 'h1', now(), now()
      ) RETURNING id
    `);
    const catalogId = (catRows[0] as { id: string }).id;

    const redRows = await isolated.db.execute(sql`
      INSERT INTO point_redemptions (
        student_id, catalog_item_id, cost_snapshot, request_month, status,
        requested_at, create_idempotency_key, create_idempotency_payload_hash, created_at
      ) VALUES (
        ${studentId}::uuid, ${catalogId}::uuid, 10, '2026-01', 'pending',
        now(), 'r1', 'h1', now()
      ) RETURNING id
    `);
    const redemptionId = (redRows[0] as { id: string }).id;

    await isolated.db.execute(sql`
      INSERT INTO point_ledger_entries (
        student_id, settlement_id, amount, reason, source_type, explanation, source_id,
        idempotency_key, created_at
      ) VALUES (
        ${studentId}::uuid, NULL, -10, 'redemption.approved', 'redemption',
        'test', ${redemptionId}::uuid, 'l1', now()
      )
    `);

    await expectConstraintFailure(
      isolated.db,
      sql`
        INSERT INTO point_ledger_entries (
          student_id, settlement_id, amount, reason, source_type, explanation, source_id,
          idempotency_key, created_at
        ) VALUES (
          ${studentId}::uuid, NULL, -10, 'redemption.approved', 'redemption',
          'dup', ${redemptionId}::uuid, 'l2', now()
        )
      `,
      { code: "23505", constraint: "point_ledger_entries_redemption_source_unique" },
    );
  });

  it("rejects invalid export job status", async () => {
    const { parentId, studentId } = await seedParentStudent(isolated.db);
    await expectConstraintFailure(
      isolated.db,
      sql`
        INSERT INTO export_jobs (
          requester_id, student_id, scope_snapshot, status,
          create_idempotency_key, create_idempotency_payload_hash, created_at, updated_at
        ) VALUES (
          ${parentId}::uuid, ${studentId}::uuid, '{}'::jsonb, 'invalid',
          'e1', 'h1', now(), now()
        )
      `,
      { code: "23514", constraint: "export_jobs_status_check" },
    );
  });

  it("rejects invalid deletion target type", async () => {
    const { parentId, studentId } = await seedParentStudent(isolated.db);
    await expectConstraintFailure(
      isolated.db,
      sql`
        INSERT INTO deletion_requests (
          target_type, target_id, student_id, requested_by, status,
          revocable_until, create_idempotency_key, create_idempotency_payload_hash,
          requested_at, created_at, updated_at
        ) VALUES (
          'invalid', ${studentId}::uuid, ${studentId}::uuid, ${parentId}::uuid, 'frozen',
          now() + interval '30 days', 'd1', 'h1', now(), now(), now()
        )
      `,
      { code: "23514", constraint: "deletion_requests_target_type_check" },
    );
  });

  it("rejects duplicate active deletion target", async () => {
    const { parentId, studentId } = await seedParentStudent(isolated.db);
    await isolated.db.execute(sql`
      INSERT INTO deletion_requests (
        target_type, target_id, student_id, requested_by, status,
        revocable_until, create_idempotency_key, create_idempotency_payload_hash,
        requested_at, created_at, updated_at
      ) VALUES (
        'student_account', ${studentId}::uuid, ${studentId}::uuid, ${parentId}::uuid, 'frozen',
        now() + interval '30 days', 'd-active-1', 'h1', now(), now(), now()
      )
    `);

    await expectConstraintFailure(
      isolated.db,
      sql`
        INSERT INTO deletion_requests (
          target_type, target_id, student_id, requested_by, status,
          revocable_until, create_idempotency_key, create_idempotency_payload_hash,
          requested_at, created_at, updated_at
        ) VALUES (
          'student_account', ${studentId}::uuid, ${studentId}::uuid, ${parentId}::uuid, 'frozen',
          now() + interval '30 days', 'd-active-2', 'h2', now(), now(), now()
        )
      `,
      { code: "23505", constraint: "deletion_requests_active_target_unique" },
    );
  });
});
