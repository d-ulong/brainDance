import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });

process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";

export default async function globalSetup() {
  const { closeTestDb, getTestDb, migrateTestDb, resetIdentityTables } =
    await import("./helpers/db");

  await migrateTestDb();
  const db = getTestDb();
  await resetIdentityTables(db);
  await closeTestDb();
}
