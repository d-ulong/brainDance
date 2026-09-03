import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { assertMediaMigrationCompatibility } from "@/db/media-migration-gate";
import { requireDatabaseUrl } from "@/lib/env";

export type RunMigrationsWithMediaGateOptions = {
  connectionString?: string;
  migrationsFolder?: string;
};

/**
 * Production migration orchestration: compatibility gate runs before any migrate()
 * mutation. Connection is always closed.
 */
export async function runMigrationsWithMediaCompatibilityGate(
  options: RunMigrationsWithMediaGateOptions = {},
): Promise<void> {
  const connectionString = options.connectionString ?? requireDatabaseUrl();
  const migrationsFolder = options.migrationsFolder ?? "./src/db/migrations";
  const sql = postgres(connectionString, { max: 1 });
  try {
    // Fail closed before drizzle can apply later migrations onto an incompatible ledger.
    await assertMediaMigrationCompatibility(sql);
    const db = drizzle(sql);
    await migrate(db, { migrationsFolder });
    // Post-check detects in-place revised files that drizzle skipped by created_at.
    await assertMediaMigrationCompatibility(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
