import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import * as schema from "@/db/schema";
import { requireDatabaseUrl } from "@/lib/env";

export type TestDb = PostgresJsDatabase<typeof schema>;

let sharedClient: ReturnType<typeof postgres> | undefined;

export function getTestDb(): TestDb {
  if (!sharedClient) {
    sharedClient = postgres(requireDatabaseUrl(), { max: 5 });
  }
  return drizzle(sharedClient, { schema });
}

export async function migrateTestDb(): Promise<void> {
  const client = postgres(requireDatabaseUrl(), { max: 1 });
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: "./src/db/migrations" });
  await client.end({ timeout: 5 });
}

export async function resetIdentityTables(db: TestDb): Promise<void> {
  await db.execute(sql`
    TRUNCATE TABLE
      audit_events,
      guardian_consents,
      training_metrics,
      training_events,
      training_profile_projection,
      training_sessions,
      training_definitions,
      family_memberships,
      relationships,
      relationship_requests,
      student_association_codes,
      families,
      login_security_events,
      contact_verification_codes,
      sessions,
      invitation_redemptions,
      invitations,
      users
    RESTART IDENTITY CASCADE
  `);
}

/** @deprecated use resetIdentityTables — truncates family + identity tables */
export const resetAllTestTables = resetIdentityTables;

export async function closeTestDb(): Promise<void> {
  if (sharedClient) {
    await sharedClient.end({ timeout: 5 });
    sharedClient = undefined;
  }
}
