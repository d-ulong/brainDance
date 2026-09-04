import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import postgres from "postgres";

import * as schema from "@/db/schema";
import {
  adminDatabaseUrl,
  databaseUrlForName,
  disposeIsolatedM2DatabaseResources,
} from "./m2-isolated-database";
import { bootstrapVerifiedParentWithInvite, seedStudentUser } from "../../helpers/family-access";
import type { TestDb } from "../../helpers/db";
import {
  DIGIT_SPAN_TRAINING_KEY,
  REACTION_TRAINING_KEY,
  STROOP_TRAINING_KEY,
} from "@/modules/training/constants";
import { getActiveTrainingDefinition } from "@/modules/training/definition.service";
import { resolveTrainingSubject } from "@/modules/training/training-subject";

config({ path: ".env.local" });
config({ path: ".env" });

const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);
const migrationsRoot = path.resolve("./src/db/migrations");

function buildJournalThrough(tagInclusive: string): string {
  const journal = JSON.parse(
    readFileSync(path.join(migrationsRoot, "meta", "_journal.json"), "utf8"),
  ) as {
    version: string;
    dialect: string;
    entries: Array<{
      idx: number;
      version: string;
      when: number;
      tag: string;
      breakpoints: boolean;
    }>;
  };
  const endIdx = journal.entries.findIndex((e) => e.tag === tagInclusive);
  if (endIdx < 0) {
    throw new Error(`journal tag not found: ${tagInclusive}`);
  }
  return JSON.stringify({
    version: journal.version,
    dialect: journal.dialect,
    entries: journal.entries.slice(0, endIdx + 1),
  });
}

async function migrateThroughTag(connectionString: string, tagInclusive: string): Promise<void> {
  const tempDir = mkdtempSync(path.join(tmpdir(), "bd-p2-trainee-mig-"));
  try {
    mkdirSync(path.join(tempDir, "meta"), { recursive: true });
    const journalJson = buildJournalThrough(tagInclusive);
    writeFileSync(path.join(tempDir, "meta", "_journal.json"), journalJson);
    const journal = JSON.parse(journalJson) as { entries: Array<{ tag: string }> };
    for (const entry of journal.entries) {
      writeFileSync(
        path.join(tempDir, `${entry.tag}.sql`),
        readFileSync(path.join(migrationsRoot, `${entry.tag}.sql`)),
      );
    }
    const client = postgres(connectionString, { max: 1 });
    const db = drizzle(client);
    try {
      await migrate(db, { migrationsFolder: tempDir });
    } finally {
      await client.end({ timeout: 5 });
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function applySqlMigration(connectionString: string, fileName: string): Promise<void> {
  const raw = readFileSync(path.join(migrationsRoot, fileName), "utf8");
  const executable = raw
    .split("--> statement-breakpoint")
    .map((part) => part.trim())
    .filter(Boolean)
    .join(";\n");
  const client = postgres(connectionString, { max: 1 });
  try {
    await client.unsafe(executable);
  } finally {
    await client.end({ timeout: 5 });
  }
}

function extractPgError(error: unknown): { code: string; constraint: string } {
  let current: unknown = error;
  for (let i = 0; i < 6 && current && typeof current === "object"; i += 1) {
    const record = current as Record<string, unknown>;
    if (typeof record.code === "string" && /^\d{5}$/.test(record.code)) {
      return {
        code: record.code,
        constraint:
          (typeof record.constraint_name === "string" && record.constraint_name) ||
          (typeof record.constraint === "string" && record.constraint) ||
          "",
      };
    }
    current = record.cause ?? record.originalError;
  }
  return { code: "", constraint: "" };
}

describe.skipIf(!hasDb)("P2 training trainee_id expand migration", () => {
  it("backfills trainee_id, installs checks/adult defs without adult seed, and rejects mismatched student_id", async () => {
    const rootUrl = process.env.DATABASE_URL!;
    const dbName = `bd_p2_trainee_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const admin = postgres(adminDatabaseUrl(rootUrl), { max: 1 });
    let client: ReturnType<typeof postgres> | undefined;

    try {
      await admin.unsafe(`CREATE DATABASE "${dbName}"`);
      const databaseUrl = databaseUrlForName(rootUrl, dbName);
      await migrateThroughTag(databaseUrl, "0031_m7_media_purge_fencing");

      client = postgres(databaseUrl, { max: 5 });
      const db = drizzle(client, { schema }) as TestDb;
      const suffix = crypto.randomUUID().slice(0, 8);
      const { parentId } = await bootstrapVerifiedParentWithInvite(
        db,
        `p2_mig_p_${suffix}@test.local`,
      );
      const { studentId } = await seedStudentUser(db, {
        username: `p2_mig_s_${suffix}`,
        password: "StudentPass123!Student",
        birthDate: "2015-06-01",
      });

      // Child historical definition only — no adult seed / seedM5.
      const [definition] = await db.execute(sql`
        INSERT INTO training_definitions (
          training_key, version, age_band, metric_schema, active
        ) VALUES (
          ${REACTION_TRAINING_KEY}, 1, '9-12', '{"trialCount": 5}'::jsonb, 1
        )
        RETURNING id, version, age_band
      `);
      const definitionId = (definition as { id: string }).id;
      const definitionVersion = (definition as { version: number }).version;
      const ageBand = (definition as { age_band: string }).age_band;

      const adultBefore = await db.execute(sql`
        SELECT training_key
        FROM training_definitions
        WHERE age_band = 'adult'
      `);
      expect(adultBefore).toHaveLength(0);

      const [session] = await db.execute(sql`
        INSERT INTO training_sessions (
          student_id, training_key, definition_id, definition_version, age_band,
          family_date, started_at, finished_at, status, session_kind,
          start_idempotency_key, submit_idempotency_key
        ) VALUES (
          ${studentId}::uuid, ${REACTION_TRAINING_KEY}, ${definitionId}::uuid, ${definitionVersion},
          ${ageBand}, '2026-03-01', now(), now(), 'completed', 'effective',
          ${`start-${suffix}`}, ${`submit-${suffix}`}
        )
        RETURNING id
      `);
      const sessionId = (session as { id: string }).id;

      await db.execute(sql`
        INSERT INTO training_profile_projection (
          student_id, training_key, definition_version, age_band, metric_key,
          best_value, last_value, last_source_session_id
        ) VALUES (
          ${studentId}::uuid, ${REACTION_TRAINING_KEY}, ${definitionVersion}, ${ageBand},
          'accuracy', '1.000000', '1.000000', ${sessionId}::uuid
        )
      `);

      await client.end({ timeout: 5 });
      client = undefined;

      await applySqlMigration(databaseUrl, "0032_p2_training_trainee_id.sql");
      await applySqlMigration(databaseUrl, "0033_p2_training_trainee_remediation.sql");

      client = postgres(databaseUrl, { max: 5 });
      const after = drizzle(client, { schema }) as TestDb;

      const sessionRows = await after.execute(sql`
        SELECT trainee_id::text AS trainee_id, student_id::text AS student_id
        FROM training_sessions
        WHERE id = ${sessionId}::uuid
      `);
      expect(sessionRows).toHaveLength(1);
      expect((sessionRows[0] as { trainee_id: string; student_id: string }).trainee_id).toBe(
        studentId,
      );
      expect((sessionRows[0] as { student_id: string }).student_id).toBe(studentId);

      const projectionRows = await after.execute(sql`
        SELECT trainee_id::text AS trainee_id, student_id::text AS student_id
        FROM training_profile_projection
        WHERE last_source_session_id = ${sessionId}::uuid
      `);
      expect(projectionRows).toHaveLength(1);
      expect((projectionRows[0] as { trainee_id: string }).trainee_id).toBe(studentId);

      const childDefs = await after.execute(sql`
        SELECT id, version, active, age_band
        FROM training_definitions
        WHERE training_key = ${REACTION_TRAINING_KEY}
          AND age_band = '9-12'
      `);
      expect(childDefs).toHaveLength(1);
      expect((childDefs[0] as { version: number; active: number }).version).toBe(1);
      expect((childDefs[0] as { active: number }).active).toBe(1);

      const adultDefs = await after.execute(sql`
        SELECT training_key, version, active
        FROM training_definitions
        WHERE age_band = 'adult'
          AND active = 1
        ORDER BY training_key
      `);
      expect(adultDefs).toHaveLength(3);
      expect(
        (adultDefs as Array<{ training_key: string }>).map((row) => row.training_key).sort(),
      ).toEqual([DIGIT_SPAN_TRAINING_KEY, REACTION_TRAINING_KEY, STROOP_TRAINING_KEY].sort());

      const parentSubject = await resolveTrainingSubject(after, parentId);
      expect(parentSubject.ageBand).toBe("adult");
      const adultReaction = await getActiveTrainingDefinition(
        after,
        REACTION_TRAINING_KEY,
        "adult",
      );
      expect(adultReaction.ageBand).toBe("adult");
      expect(adultReaction.active).toBe(1);

      const indexes = await after.execute(sql`
        SELECT indexname
        FROM pg_indexes
        WHERE indexname IN (
          'training_sessions_start_idempotency_trainee_scoped',
          'training_sessions_submit_idempotency_trainee_scoped',
          'training_sessions_effective_daily_trainee_unique',
          'training_sessions_trainee_key_date_idx',
          'training_profile_projection_trainee_key_idx'
        )
      `);
      expect(indexes.length).toBe(5);

      const oldIndexes = await after.execute(sql`
        SELECT indexname
        FROM pg_indexes
        WHERE indexname IN (
          'training_sessions_start_idempotency_scoped',
          'training_sessions_effective_daily_unique'
        )
      `);
      expect(oldIndexes.length).toBe(2);

      try {
        await after.execute(sql`
          INSERT INTO training_sessions (
            trainee_id, student_id, training_key, definition_id, definition_version, age_band,
            family_date, started_at, finished_at, status, session_kind
          ) VALUES (
            ${studentId}::uuid, ${studentId}::uuid, ${REACTION_TRAINING_KEY}, ${definitionId}::uuid,
            ${definitionVersion}, ${ageBand}, '2026-03-01', now(), now(), 'completed', 'effective'
          )
        `);
        throw new Error("Expected trainee effective-daily unique violation");
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "Expected trainee effective-daily unique violation"
        ) {
          throw error;
        }
        const { code, constraint } = extractPgError(error);
        expect(code).toBe("23505");
        expect(constraint).toMatch(/training_sessions_effective_daily/);
      }

      try {
        await after.execute(sql`
          INSERT INTO training_sessions (
            trainee_id, student_id, training_key, definition_id, definition_version, age_band,
            family_date, started_at, status
          ) VALUES (
            ${studentId}::uuid, ${parentId}::uuid, ${REACTION_TRAINING_KEY}, ${definitionId}::uuid,
            ${definitionVersion}, ${ageBand}, '2026-03-02', now(), 'active'
          )
        `);
        throw new Error("Expected student_id/trainee_id CHECK violation");
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "Expected student_id/trainee_id CHECK violation"
        ) {
          throw error;
        }
        const { code, constraint } = extractPgError(error);
        expect(code).toBe("23514");
        expect(constraint).toMatch(/training_sessions_student_trainee_match_check/);
      }

      try {
        await after.execute(sql`
          INSERT INTO training_profile_projection (
            trainee_id, student_id, training_key, definition_version, age_band, metric_key,
            best_value, last_value
          ) VALUES (
            ${studentId}::uuid, ${parentId}::uuid, ${REACTION_TRAINING_KEY}, ${definitionVersion},
            ${ageBand}, 'mismatch', '1.000000', '1.000000'
          )
        `);
        throw new Error("Expected projection student_id/trainee_id CHECK violation");
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "Expected projection student_id/trainee_id CHECK violation"
        ) {
          throw error;
        }
        const { code, constraint } = extractPgError(error);
        expect(code).toBe("23514");
        expect(constraint).toMatch(/training_profile_projection_student_trainee_match_check/);
      }
    } finally {
      await disposeIsolatedM2DatabaseResources({
        admin,
        dbName,
        client,
      });
    }
  });
});
