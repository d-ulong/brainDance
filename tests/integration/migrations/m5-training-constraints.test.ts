import { config } from "dotenv";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { STROOP_TRAINING_KEY } from "@/modules/training/constants";
import { closeTestDb, getTestDb, migrateTestDb } from "../../helpers/db";

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

describe.skipIf(!hasDb)("M5 training schema constraints", () => {
  const db = getTestDb();

  beforeAll(async () => {
    await migrateTestDb();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("enforces one active definition per training key and age band", async () => {
    await db.execute(sql`
      INSERT INTO training_definitions (training_key, version, age_band, metric_schema, active)
      VALUES (${STROOP_TRAINING_KEY}, 99, '9-12', '{}'::jsonb, 1)
    `);

    try {
      await db.execute(sql`
        INSERT INTO training_definitions (training_key, version, age_band, metric_schema, active)
        VALUES (${STROOP_TRAINING_KEY}, 100, '9-12', '{}'::jsonb, 1)
      `);
      throw new Error("Expected active definition unique violation");
    } catch (error) {
      const failure = unwrapPgFailure(error);
      expect(failure.code).toBe("23505");
      expect(failure.constraint).toBe("training_definitions_active_key_age_unique");
    } finally {
      await db.execute(sql`
        DELETE FROM training_definitions
        WHERE training_key = ${STROOP_TRAINING_KEY}
          AND version IN (99, 100)
          AND age_band = '9-12'
      `);
    }
  });

  it("enforces one effective completed session per student, training key, and family date", async () => {
    const rows = await db.execute(sql`
      SELECT indexname
      FROM pg_indexes
      WHERE indexname = 'training_sessions_effective_daily_unique'
    `);
    expect(rows.length).toBeGreaterThan(0);
  });
});
