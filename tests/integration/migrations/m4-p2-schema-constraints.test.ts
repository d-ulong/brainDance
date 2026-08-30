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

describe.skipIf(!hasDb)("M4 P2 schema constraints", () => {
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

  it("documents migration 0019 reflection privacy metadata", () => {
    const migration = readFileSync(
      path.join(process.cwd(), "src/db/migrations/0019_m4_reflection_privacy.sql"),
      "utf8",
    );

    expect(migration).toContain("daily_reflections_student_date_active_unique");
    expect(migration).toContain("private_access_grants_active_unique");
    expect(migration).toContain("daily_reflection_versions_reflection_version_unique");
  });

  it("rejects duplicate active daily reflections for same student and date", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const student = await seedStudentUser(db, {
      username: `student_${suffix}`,
      password: "StudentPass123!Student",
    });

    await db.execute(sql`
      INSERT INTO daily_reflections (student_id, family_date, visibility, body)
      VALUES (${student.studentId}::uuid, CURRENT_DATE, 'normal', 'first')
    `);

    await expectConstraintFailure(
      db,
      sql`
        INSERT INTO daily_reflections (student_id, family_date, visibility, body)
        VALUES (${student.studentId}::uuid, CURRENT_DATE, 'normal', 'second')
      `,
      {
        code: "23505",
        constraint: "daily_reflections_student_date_active_unique",
      },
    );
  });

  it("rejects duplicate active private access grants", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const { parentId } = await bootstrapVerifiedParentWithInvite(db, `parent_${suffix}@test.local`);
    const student = await seedStudentUser(db, {
      username: `student_${suffix}`,
      password: "StudentPass123!Student",
    });

    const reflectionRows = await db.execute(sql`
      INSERT INTO daily_reflections (student_id, family_date, visibility, body)
      VALUES (${student.studentId}::uuid, CURRENT_DATE, 'private', 'secret')
      RETURNING id
    `);
    const reflectionId = (reflectionRows as unknown as { id: string }[])[0]?.id;
    if (!reflectionId) {
      throw new Error("Expected reflection");
    }

    await db.execute(sql`
      INSERT INTO private_access_grants (resource_type, resource_id, parent_id)
      VALUES ('daily_reflection', ${reflectionId}::uuid, ${parentId}::uuid)
    `);

    await expectConstraintFailure(
      db,
      sql`
        INSERT INTO private_access_grants (resource_type, resource_id, parent_id)
        VALUES ('daily_reflection', ${reflectionId}::uuid, ${parentId}::uuid)
      `,
      {
        code: "23505",
        constraint: "private_access_grants_active_unique",
      },
    );
  });
});
