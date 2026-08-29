import { readFileSync } from "node:fs";
import path from "node:path";

import { config } from "dotenv";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  closeTestDb,
  getTestDb,
  migrateTestDb,
  resetIdentityTables,
  type TestDb,
} from "../../helpers/db";
import { bootstrapVerifiedParentWithInvite, seedStudentUser } from "../../helpers/family-access";

config({ path: ".env.local" });
config({ path: ".env" });

const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);

type PgFailure = { code?: string; constraint?: string };

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
  db: TestDb,
  statement: ReturnType<typeof sql>,
  expected: { code: string; constraint?: string },
): Promise<void> {
  try {
    await db.execute(statement);
    throw new Error(
      `Expected SQLSTATE ${expected.code}${expected.constraint ? ` ${expected.constraint}` : ""} but the statement succeeded`,
    );
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

describe.skipIf(!hasDb)("M4 schema constraints", () => {
  const db = getTestDb();

  beforeAll(async () => {
    await migrateTestDb();
  });

  beforeEach(async () => {
    await resetIdentityTables(db);
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("documents migration 0018 indexes and trigger metadata", () => {
    const migration = readFileSync(
      path.join(process.cwd(), "src/db/migrations/0018_m4_multi_parent_authorization.sql"),
      "utf8",
    );

    expect(migration).toContain("family_memberships_active_family_user_unique");
    expect(migration).toContain("family_memberships_user_active_idx");
    expect(migration).toContain("relationships_family_parent_active_idx");
    expect(migration).toContain("relationships_family_student_active_idx");
    expect(migration).toContain("relationships_student_single_active_family_trg");
  });

  it("rejects duplicate active parent-student relationships", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const { parentId } = await bootstrapVerifiedParentWithInvite(db, `parent_${suffix}@test.local`);
    const { studentId } = await seedStudentUser(db, {
      username: `student_${suffix}`,
      password: "StudentPass123!Student",
    });

    const familyRows = await db.execute(sql`
      INSERT INTO families (timezone) VALUES ('Asia/Shanghai') RETURNING id
    `);
    const familyId = (familyRows as unknown as { id: string }[])[0]?.id;
    if (!familyId) {
      throw new Error("Expected family");
    }

    await db.execute(sql`
      INSERT INTO relationships (family_id, parent_id, student_id, status, accepted_at)
      VALUES (${familyId}::uuid, ${parentId}::uuid, ${studentId}::uuid, 'active', now())
    `);

    await expectConstraintFailure(
      db,
      sql`
        INSERT INTO relationships (family_id, parent_id, student_id, status, accepted_at)
        VALUES (${familyId}::uuid, ${parentId}::uuid, ${studentId}::uuid, 'active', now())
      `,
      {
        code: "23505",
        constraint: "relationships_active_parent_student_unique",
      },
    );
  });

  it("rejects active relationships for the same student in different families", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const { parentId: parent1Id } = await bootstrapVerifiedParentWithInvite(
      db,
      `parent1_${suffix}@test.local`,
    );
    const { parentId: parent2Id } = await bootstrapVerifiedParentWithInvite(
      db,
      `parent2_${suffix}@test.local`,
    );
    const { studentId } = await seedStudentUser(db, {
      username: `student_${suffix}`,
      password: "StudentPass123!Student",
    });

    const families = await db.execute(sql`
      INSERT INTO families (timezone) VALUES ('Asia/Shanghai'), ('Asia/Shanghai')
      RETURNING id
    `);
    const familyRows = families as unknown as { id: string }[];
    const family1Id = familyRows[0]?.id;
    const family2Id = familyRows[1]?.id;
    if (!family1Id || !family2Id) {
      throw new Error("Expected families");
    }

    await db.execute(sql`
      INSERT INTO relationships (family_id, parent_id, student_id, status, accepted_at)
      VALUES (${family1Id}::uuid, ${parent1Id}::uuid, ${studentId}::uuid, 'active', now())
    `);

    await expectConstraintFailure(
      db,
      sql`
        INSERT INTO relationships (family_id, parent_id, student_id, status, accepted_at)
        VALUES (${family2Id}::uuid, ${parent2Id}::uuid, ${studentId}::uuid, 'active', now())
      `,
      {
        code: "23514",
        constraint: "relationships_student_single_active_family",
      },
    );
  });

  it("rejects duplicate active family memberships for the same user", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const { parentId } = await bootstrapVerifiedParentWithInvite(db, `parent_${suffix}@test.local`);

    const familyRows = await db.execute(sql`
      INSERT INTO families (timezone) VALUES ('Asia/Shanghai') RETURNING id
    `);
    const familyId = (familyRows as unknown as { id: string }[])[0]?.id;
    if (!familyId) {
      throw new Error("Expected family");
    }

    await db.execute(sql`
      INSERT INTO family_memberships (family_id, user_id, member_role, joined_at)
      VALUES (${familyId}::uuid, ${parentId}::uuid, 'parent', now())
    `);

    await expectConstraintFailure(
      db,
      sql`
        INSERT INTO family_memberships (family_id, user_id, member_role, joined_at)
        VALUES (${familyId}::uuid, ${parentId}::uuid, 'parent', now())
      `,
      {
        code: "23505",
        constraint: "family_memberships_active_family_user_unique",
      },
    );
  });
});
