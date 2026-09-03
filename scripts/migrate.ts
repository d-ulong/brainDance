import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { assertMediaMigrationCompatibility } from "../src/db/media-migration-gate";
import { requireDatabaseUrl } from "../src/lib/env";

config({ path: ".env.local" });
config({ path: ".env" });

async function main() {
  const connectionString = requireDatabaseUrl();
  const sql = postgres(connectionString, { max: 1 });
  const db = drizzle(sql);

  console.log("Running migrations...");
  await migrate(db, { migrationsFolder: "./src/db/migrations" });
  console.log("Migrations complete.");

  // Detect in-place revised pre-release media migrations that drizzle will not re-run.
  await assertMediaMigrationCompatibility(sql);
  console.log("Media migration compatibility check passed.");

  await sql.end({ timeout: 5 });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
