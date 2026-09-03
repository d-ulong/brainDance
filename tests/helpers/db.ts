import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import * as schema from "@/db/schema";
import { requireDatabaseUrl } from "@/lib/env";

export type TestDb = PostgresJsDatabase<typeof schema>;

let sharedClient: ReturnType<typeof postgres> | undefined;
let resetQueue: Promise<void> = Promise.resolve();

export function getTestDb(): TestDb {
  if (!sharedClient) {
    sharedClient = postgres(requireDatabaseUrl(), { max: 5 });
  }
  return drizzle(sharedClient, { schema });
}

/** Shared postgres.js client backing `getTestDb()` — same DATABASE_URL authority. */
export function getTestSqlClient(): ReturnType<typeof postgres> {
  getTestDb();
  if (!sharedClient) {
    throw new Error("Test postgres client is not initialized");
  }
  return sharedClient;
}

export async function migrateTestDb(): Promise<void> {
  const client = postgres(requireDatabaseUrl(), { max: 1 });
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: "./src/db/migrations" });
  await client.end({ timeout: 5 });
}

export async function resetIdentityTables(db: TestDb): Promise<void> {
  const run = resetQueue.then(async () => {
    await db.execute(sql`
      TRUNCATE TABLE
        notifications,
        media_read_capabilities,
        media_purge_intents,
        media_references,
        media_objects,
        push_comment_versions,
        push_comments,
        push_answer_versions,
        push_answers,
        family_push_versions,
        family_pushes,
        deletion_capabilities,
        deletion_execution_steps,
        deletion_tombstones,
        deletion_requests,
        export_jobs,
        audit_events,
        outbox_events,
        private_access_grants,
        daily_reflection_versions,
        daily_reflections,
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
  });

  resetQueue = run.catch(() => undefined);
  await run;
}

/** @deprecated use resetIdentityTables — truncates family + identity tables */
export const resetAllTestTables = resetIdentityTables;

export async function closeTestDb(): Promise<void> {
  if (sharedClient) {
    await sharedClient.end({ timeout: 5 });
    sharedClient = undefined;
  }
}

export function createIndependentTestDb(): {
  db: TestDb;
  close: () => Promise<void>;
} {
  const client = postgres(requireDatabaseUrl(), { max: 1 });
  const db = drizzle(client, { schema });
  return {
    db,
    close: async () => {
      await client.end({ timeout: 5 });
    },
  };
}
