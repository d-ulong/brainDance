import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { describe, expect, it } from "vitest";
import postgres from "postgres";

import * as schema from "@/db/schema";
import {
  assertMediaMigrationCompatibility,
  expectedHashForTag,
  findJournalEntry,
  findMigrationHashMismatches,
  hashMigrationSql,
  MediaMigrationCompatibilityError,
  M7_MEDIA_PRE_RELEASE_TAGS,
} from "@/db/media-migration-gate";
import {
  adminDatabaseUrl,
  closeIsolatedM2Database,
  databaseUrlForName,
  disposeIsolatedM2DatabaseResources,
  openIsolatedM2Database,
} from "./m2-isolated-database";
import { bootstrapVerifiedParentWithInvite, seedStudentUser } from "../../helpers/family-access";
import type { TestDb } from "../../helpers/db";

config({ path: ".env.local" });
config({ path: ".env" });

const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);
const migrationsRoot = path.resolve("./src/db/migrations");
const repoRoot = path.resolve(".");

/** Old in-place 0030 from dd7b350 — silently deleted unbackfillable rows. */
function loadOld0030SqlFromGit(): string {
  return execFileSync(
    "git",
    ["show", "dd7b350899b9039ab06d7e1f492b2f6a69ab85fe:src/db/migrations/0030_m7_media_student_binding.sql"],
    { cwd: repoRoot, encoding: "utf8" },
  );
}

function readMigrationSql(name: string): string {
  return readFileSync(path.join(migrationsRoot, name), "utf8");
}

function buildJournalThrough(tagInclusive: string): string {
  const journal = JSON.parse(
    readFileSync(path.join(migrationsRoot, "meta", "_journal.json"), "utf8"),
  ) as {
    version: string;
    dialect: string;
    entries: Array<{ idx: number; version: string; when: number; tag: string; breakpoints: boolean }>;
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
  const tempDir = mkdtempSync(path.join(tmpdir(), "bd-m7-mig-"));
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

async function migrateFullFolder(connectionString: string): Promise<void> {
  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client);
  try {
    await migrate(db, { migrationsFolder: migrationsRoot });
  } finally {
    await client.end({ timeout: 5 });
  }
}

function toExecutableSql(migrationSql: string): string {
  return migrationSql
    .split("--> statement-breakpoint")
    .map((part) => part.trim())
    .filter(Boolean)
    .join(";\n");
}

async function withDbThrough0029<T>(
  run: (input: {
    client: ReturnType<typeof postgres>;
    db: TestDb;
    parentId: string;
    studentId: string;
    suffix: string;
  }) => Promise<T>,
): Promise<T> {
  const rootUrl = process.env.DATABASE_URL!;
  const dbName = `bd_m7_0030_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const admin = postgres(adminDatabaseUrl(rootUrl), { max: 1 });
  let client: ReturnType<typeof postgres> | undefined;
  try {
    await admin.unsafe(`CREATE DATABASE "${dbName}"`);
    const databaseUrl = databaseUrlForName(rootUrl, dbName);
    await migrateThroughTag(databaseUrl, "0029_m7_family_media");
    client = postgres(databaseUrl, { max: 5 });
    const db = drizzle(client, { schema }) as TestDb;
    const suffix = crypto.randomUUID().slice(0, 8);
    const { parentId } = await bootstrapVerifiedParentWithInvite(
      db,
      `m7_mig_p_${suffix}@test.local`,
    );
    const { studentId } = await seedStudentUser(db, {
      username: `m7_mig_s_${suffix}`,
      password: "StudentPass123!Student",
    });
    return await run({ client, db, parentId, studentId, suffix });
  } finally {
    await disposeIsolatedM2DatabaseResources({ admin, dbName, client });
  }
}

describe("m7 media migration publish boundary (git evidence)", () => {
  it("0029–0031 are absent from main and from release tags", () => {
    for (const tag of M7_MEDIA_PRE_RELEASE_TAGS) {
      const onMain = execFileSync(
        "git",
        ["ls-tree", "-r", "main", "--name-only", `src/db/migrations/${tag}.sql`],
        { cwd: repoRoot, encoding: "utf8" },
      ).trim();
      expect(onMain).toBe("");
    }

    const tags = execFileSync("git", ["tag", "-l"], { cwd: repoRoot, encoding: "utf8" })
      .split(/\r?\n/)
      .map((t) => t.trim())
      .filter(Boolean);
    for (const releaseTag of tags) {
      for (const migrationTag of M7_MEDIA_PRE_RELEASE_TAGS) {
        const listed = execFileSync(
          "git",
          ["ls-tree", "-r", releaseTag, "--name-only", `src/db/migrations/${migrationTag}.sql`],
          { cwd: repoRoot, encoding: "utf8" },
        ).trim();
        expect(listed).toBe("");
      }
    }

    const mainJournal = execFileSync("git", ["show", "main:src/db/migrations/meta/_journal.json"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    expect(mainJournal).not.toContain("0029_m7_family_media");
    expect(mainJournal).not.toContain("0030_m7_media_student_binding");
    expect(mainJournal).not.toContain("0031_m7_media_purge_fencing");
  });
});

describe.skipIf(!hasDb)("m7 media student binding migration (0030)", () => {
  it("0030 SQL refuses silent delete of unbackfillable media facts", () => {
    const sqlText = readMigrationSql("0030_m7_media_student_binding.sql");
    expect(sqlText).not.toMatch(
      /DELETE\s+FROM\s+"media_objects"\s+WHERE\s+"student_id"\s+IS\s+NULL/i,
    );
    expect(sqlText).toMatch(/RAISE EXCEPTION/i);
    expect(sqlText).toMatch(/cannot be uniquely backfilled/i);
  });

  it("0030 fails closed on unbackfillable rows without deleting media/ref/intent/cap facts", async () => {
    await withDbThrough0029(async ({ client, parentId, studentId, suffix }) => {
      const goodId = crypto.randomUUID();
      const badId = crypto.randomUUID();
      const refId = crypto.randomUUID();
      const intentId = crypto.randomUUID();
      const capId = crypto.randomUUID();
      const pushVersionId = crypto.randomUUID();

      await client`
        INSERT INTO media_objects (
          id, uploader_id, status, declared_mime, detected_mime, content_sha256, byte_size,
          staging_object_key, safe_object_key, scan_result, create_idempotency_key,
          create_idempotency_payload_hash, ready_at
        ) VALUES (
          ${goodId}::uuid, ${parentId}::uuid, 'ready', 'image/png', 'image/png', 'sha256good', 128,
          ${`staging/${studentId}/${goodId}`}, ${`safe/${studentId}/${goodId}`}, 'clean',
          ${`good-${suffix}`}, ${`hash-good-${suffix}`}, now()
        )
      `;
      await client`
        INSERT INTO media_objects (
          id, uploader_id, status, declared_mime, byte_size,
          staging_object_key, scan_result, create_idempotency_key, create_idempotency_payload_hash
        ) VALUES (
          ${badId}::uuid, ${parentId}::uuid, 'staging', 'image/png', 64,
          ${`staging/not-a-uuid/${badId}`}, 'pending', ${`bad-${suffix}`}, ${`hash-bad-${suffix}`}
        )
      `;
      await client`
        INSERT INTO media_references (
          id, media_id, resource_type, resource_id, purpose, student_id
        ) VALUES (
          ${refId}::uuid, ${goodId}::uuid, 'family_push_version', ${pushVersionId}::uuid,
          'push_image', ${studentId}::uuid
        )
      `;
      await client`
        INSERT INTO media_purge_intents (id, media_id, status, purge_after)
        VALUES (${intentId}::uuid, ${goodId}::uuid, 'pending', now() + interval '90 days')
      `;
      await client`
        INSERT INTO media_read_capabilities (
          id, token_hash, media_id, reference_id, actor_id, student_id,
          authorization_epoch, expires_at
        ) VALUES (
          ${capId}::uuid, ${`tok-${suffix}`}, ${goodId}::uuid, ${refId}::uuid,
          ${parentId}::uuid, ${studentId}::uuid, 0, now() + interval '1 hour'
        )
      `;

      await expect(
        client.unsafe(toExecutableSql(readMigrationSql("0030_m7_media_student_binding.sql"))),
      ).rejects.toThrow(/cannot be uniquely backfilled|m7_media_student_binding/i);

      expect((await client`SELECT id FROM media_objects WHERE id = ${badId}::uuid`).length).toBe(1);
      expect((await client`SELECT id FROM media_objects WHERE id = ${goodId}::uuid`).length).toBe(1);
      expect((await client`SELECT id FROM media_references WHERE id = ${refId}::uuid`).length).toBe(
        1,
      );
      expect(
        (await client`SELECT id FROM media_purge_intents WHERE id = ${intentId}::uuid`).length,
      ).toBe(1);
      expect(
        (await client`SELECT id FROM media_read_capabilities WHERE id = ${capId}::uuid`).length,
      ).toBe(1);
    });
  }, 180_000);

  it("0030 backfills legal staging keys and preserves related reference/intent/capability", async () => {
    await withDbThrough0029(async ({ client, parentId, studentId, suffix }) => {
      const goodId = crypto.randomUUID();
      const refId = crypto.randomUUID();
      const intentId = crypto.randomUUID();
      const capId = crypto.randomUUID();
      const pushVersionId = crypto.randomUUID();

      await client`
        INSERT INTO media_objects (
          id, uploader_id, status, declared_mime, detected_mime, content_sha256, byte_size,
          staging_object_key, safe_object_key, scan_result, create_idempotency_key,
          create_idempotency_payload_hash, ready_at
        ) VALUES (
          ${goodId}::uuid, ${parentId}::uuid, 'ready', 'image/png', 'image/png', 'sha256good', 128,
          ${`staging/${studentId}/${goodId}`}, ${`safe/${studentId}/${goodId}`}, 'clean',
          ${`good-${suffix}`}, ${`hash-good-${suffix}`}, now()
        )
      `;
      await client`
        INSERT INTO media_references (
          id, media_id, resource_type, resource_id, purpose, student_id
        ) VALUES (
          ${refId}::uuid, ${goodId}::uuid, 'family_push_version', ${pushVersionId}::uuid,
          'push_image', ${studentId}::uuid
        )
      `;
      await client`
        INSERT INTO media_purge_intents (id, media_id, status, purge_after)
        VALUES (${intentId}::uuid, ${goodId}::uuid, 'pending', now() + interval '90 days')
      `;
      await client`
        INSERT INTO media_read_capabilities (
          id, token_hash, media_id, reference_id, actor_id, student_id,
          authorization_epoch, expires_at
        ) VALUES (
          ${capId}::uuid, ${`tok-ok-${suffix}`}, ${goodId}::uuid, ${refId}::uuid,
          ${parentId}::uuid, ${studentId}::uuid, 0, now() + interval '1 hour'
        )
      `;

      await client.unsafe(toExecutableSql(readMigrationSql("0030_m7_media_student_binding.sql")));

      const [good] = await client`
        SELECT student_id::text AS student_id FROM media_objects WHERE id = ${goodId}::uuid
      `;
      expect(good?.student_id).toBe(studentId);
      expect((await client`SELECT id FROM media_references WHERE id = ${refId}::uuid`).length).toBe(
        1,
      );
      expect(
        (await client`SELECT id FROM media_purge_intents WHERE id = ${intentId}::uuid`).length,
      ).toBe(1);
      expect(
        (await client`SELECT id FROM media_read_capabilities WHERE id = ${capId}::uuid`).length,
      ).toBe(1);

      const notNull = await client`
        SELECT is_nullable FROM information_schema.columns
        WHERE table_name = 'media_objects' AND column_name = 'student_id'
      `;
      expect(notNull[0]?.is_nullable).toBe("NO");
    });
  }, 180_000);

  it("full migrate through 0031 keeps student_id NOT NULL with purge fencing columns", async () => {
    const isolated = await openIsolatedM2Database({
      dbName: `bd_m7_0031_${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`,
    });
    try {
      const cols = await isolated.client`
        SELECT column_name, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'media_objects'
          AND column_name IN ('student_id', 'purge_generation')
        ORDER BY column_name
      `;
      expect(cols).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ column_name: "purge_generation", is_nullable: "NO" }),
          expect.objectContaining({ column_name: "student_id", is_nullable: "NO" }),
        ]),
      );
      const intentCols = await isolated.client`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'media_purge_intents' AND column_name = 'owned_generation'
      `;
      expect(intentCols).toHaveLength(1);
      await assertMediaMigrationCompatibility(isolated.client);
    } finally {
      await closeIsolatedM2Database(isolated);
    }
  }, 180_000);

  it("main migration state upgrades once to branch final schema", async () => {
    const rootUrl = process.env.DATABASE_URL!;
    const dbName = `bd_m7_mainup_${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`;
    const admin = postgres(adminDatabaseUrl(rootUrl), { max: 1 });
    let client: ReturnType<typeof postgres> | undefined;
    try {
      await admin.unsafe(`CREATE DATABASE "${dbName}"`);
      const databaseUrl = databaseUrlForName(rootUrl, dbName);
      await migrateThroughTag(databaseUrl, "0027_m6_deletion_capabilities");
      await migrateFullFolder(databaseUrl);
      client = postgres(databaseUrl, { max: 1 });

      const cols = await client`
        SELECT column_name, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'media_objects'
          AND column_name IN ('student_id', 'purge_generation')
      `;
      expect(cols).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ column_name: "purge_generation", is_nullable: "NO" }),
          expect.objectContaining({ column_name: "student_id", is_nullable: "NO" }),
        ]),
      );
      const intentCols = await client`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'media_purge_intents' AND column_name = 'owned_generation'
      `;
      expect(intentCols).toHaveLength(1);
      await assertMediaMigrationCompatibility(client);
    } finally {
      await disposeIsolatedM2DatabaseResources({ admin, dbName, client });
    }
  }, 180_000);

  it("recorded old 0030 checksum fails compatibility gate without re-executing revised SQL", async () => {
    const rootUrl = process.env.DATABASE_URL!;
    const dbName = `bd_m7_old30_${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`;
    const admin = postgres(adminDatabaseUrl(rootUrl), { max: 1 });
    let client: ReturnType<typeof postgres> | undefined;
    try {
      await admin.unsafe(`CREATE DATABASE "${dbName}"`);
      const databaseUrl = databaseUrlForName(rootUrl, dbName);
      await migrateThroughTag(databaseUrl, "0029_m7_family_media");
      client = postgres(databaseUrl, { max: 1 });

      await client.unsafe(toExecutableSql(loadOld0030SqlFromGit()));
      const oldHash = hashMigrationSql(loadOld0030SqlFromGit());
      const currentHash = expectedHashForTag("0030_m7_media_student_binding");
      expect(oldHash).not.toBe(currentHash);
      expect(loadOld0030SqlFromGit()).toMatch(/DELETE\s+FROM\s+"media_objects"/i);
      expect(readMigrationSql("0030_m7_media_student_binding.sql")).toMatch(/RAISE EXCEPTION/i);

      const entry = findJournalEntry("0030_m7_media_student_binding");
      await client`
        INSERT INTO drizzle.__drizzle_migrations ("hash", "created_at")
        VALUES (${oldHash}, ${entry.when})
      `;

      const mismatches = findMigrationHashMismatches(
        await client`SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at ASC`,
      );
      expect(mismatches).toEqual([
        expect.objectContaining({
          tag: "0030_m7_media_student_binding",
          recordedHash: oldHash,
          expectedHash: currentHash,
        }),
      ]);

      await expect(assertMediaMigrationCompatibility(client)).rejects.toBeInstanceOf(
        MediaMigrationCompatibilityError,
      );
      await expect(assertMediaMigrationCompatibility(client)).rejects.toThrow(
        /Rebuild this non-production development database/i,
      );

      // Drizzle would skip revised 0030 by created_at — gate must not pretend it re-ran.
      const beforeMigrate = await client`SELECT hash FROM drizzle.__drizzle_migrations WHERE created_at = ${entry.when}`;
      expect(beforeMigrate[0]?.hash).toBe(oldHash);
      await migrateFullFolder(databaseUrl);
      const afterMigrate = await client`SELECT hash FROM drizzle.__drizzle_migrations WHERE created_at = ${entry.when}`;
      expect(afterMigrate[0]?.hash).toBe(oldHash);
      await expect(assertMediaMigrationCompatibility(client)).rejects.toBeInstanceOf(
        MediaMigrationCompatibilityError,
      );
    } finally {
      await disposeIsolatedM2DatabaseResources({ admin, dbName, client });
    }
  }, 180_000);
});
