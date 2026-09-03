import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import type postgres from "postgres";

/** Pre-release M7 media lineage that must not be treated as published. */
export const M7_MEDIA_PRE_RELEASE_TAGS = [
  "0029_m7_family_media",
  "0030_m7_media_student_binding",
  "0031_m7_media_purge_fencing",
] as const;

export type M7MediaPreReleaseTag = (typeof M7_MEDIA_PRE_RELEASE_TAGS)[number];

export class MediaMigrationCompatibilityError extends Error {
  readonly code = "MEDIA_MIGRATION_COMPATIBILITY" as const;

  constructor(message: string) {
    super(message);
    this.name = "MediaMigrationCompatibilityError";
  }
}

type JournalEntry = {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
};

type Journal = {
  version: string;
  dialect: string;
  entries: JournalEntry[];
};

export type AppliedMigrationRow = {
  id: number;
  hash: string;
  created_at: string | number | bigint;
};

export type MigrationHashMismatch = {
  tag: string;
  folderMillis: number;
  recordedHash: string;
  expectedHash: string;
};

function defaultMigrationsRoot(): string {
  return path.resolve("./src/db/migrations");
}

export function readMigrationsJournal(migrationsRoot = defaultMigrationsRoot()): Journal {
  return JSON.parse(
    readFileSync(path.join(migrationsRoot, "meta", "_journal.json"), "utf8"),
  ) as Journal;
}

/** Same hash algorithm drizzle-orm uses for __drizzle_migrations.hash. */
export function hashMigrationSql(sqlText: string): string {
  return createHash("sha256").update(sqlText).digest("hex");
}

export function readMigrationSqlFile(
  tag: string,
  migrationsRoot = defaultMigrationsRoot(),
): string {
  return readFileSync(path.join(migrationsRoot, `${tag}.sql`), "utf8");
}

export function expectedHashForTag(
  tag: string,
  migrationsRoot = defaultMigrationsRoot(),
): string {
  return hashMigrationSql(readMigrationSqlFile(tag, migrationsRoot));
}

export function findJournalEntry(tag: string, migrationsRoot = defaultMigrationsRoot()): JournalEntry {
  const entry = readMigrationsJournal(migrationsRoot).entries.find((e) => e.tag === tag);
  if (!entry) {
    throw new Error(`migration journal missing tag: ${tag}`);
  }
  return entry;
}

/**
 * Compare applied drizzle rows (by created_at = journal.when) against current SQL files.
 * Does not mutate or rebuild any database.
 */
export function findMigrationHashMismatches(
  applied: AppliedMigrationRow[],
  tags: readonly string[] = M7_MEDIA_PRE_RELEASE_TAGS,
  migrationsRoot = defaultMigrationsRoot(),
): MigrationHashMismatch[] {
  const byCreatedAt = new Map<string, AppliedMigrationRow>();
  for (const row of applied) {
    byCreatedAt.set(String(row.created_at), row);
  }

  const mismatches: MigrationHashMismatch[] = [];
  for (const tag of tags) {
    const entry = findJournalEntry(tag, migrationsRoot);
    const recorded = byCreatedAt.get(String(entry.when));
    if (!recorded) {
      continue;
    }
    const expectedHash = expectedHashForTag(tag, migrationsRoot);
    if (recorded.hash !== expectedHash) {
      mismatches.push({
        tag,
        folderMillis: entry.when,
        recordedHash: recorded.hash,
        expectedHash,
      });
    }
  }
  return mismatches;
}

export function formatRebuildDevDatabaseGuidance(mismatches: MigrationHashMismatch[]): string {
  const details = mismatches
    .map(
      (m) =>
        `${m.tag}: recorded=${m.recordedHash.slice(0, 12)}… expected=${m.expectedHash.slice(0, 12)}…`,
    )
    .join("; ");
  return [
    "Media migration compatibility check failed.",
    "An already-applied pre-release migration SQL file was revised in-place; drizzle will not re-execute it.",
    `Mismatches: ${details}`,
    "Rebuild this non-production development database from the current migration lineage (drop/recreate the isolated or local dev DB), then re-run migrations.",
    "Do not claim the revised SQL has been applied to databases that still record the old checksum.",
  ].join(" ");
}

export async function loadAppliedDrizzleMigrations(
  client: ReturnType<typeof postgres>,
): Promise<AppliedMigrationRow[]> {
  const exists = await client`
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'drizzle' AND table_name = '__drizzle_migrations'
    LIMIT 1
  `;
  if (exists.length === 0) {
    return [];
  }
  return (await client`
    SELECT id, hash, created_at
    FROM drizzle.__drizzle_migrations
    ORDER BY created_at ASC, id ASC
  `) as AppliedMigrationRow[];
}

/**
 * Startup / migrate gate: if a recorded pre-release media migration hash diverges
 * from the current SQL file, fail closed with rebuild guidance for non-prod DBs.
 */
export async function assertMediaMigrationCompatibility(
  client: ReturnType<typeof postgres>,
  options?: {
    migrationsRoot?: string;
    tags?: readonly string[];
  },
): Promise<void> {
  const applied = await loadAppliedDrizzleMigrations(client);
  const mismatches = findMigrationHashMismatches(
    applied,
    options?.tags ?? M7_MEDIA_PRE_RELEASE_TAGS,
    options?.migrationsRoot ?? defaultMigrationsRoot(),
  );
  if (mismatches.length > 0) {
    throw new MediaMigrationCompatibilityError(formatRebuildDevDatabaseGuidance(mismatches));
  }
}
