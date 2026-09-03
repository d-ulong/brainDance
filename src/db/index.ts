import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;

let client: ReturnType<typeof postgres> | undefined;
let db: Database | undefined;

export function createDb(connectionString: string): Database {
  const sql = postgres(connectionString, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  return drizzle(sql, { schema });
}

export function getDb(): Database {
  if (!db) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL is not set");
    }
    client = postgres(url, {
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
    });
    db = drizzle(client, { schema });
  }
  return db;
}

/** Shared postgres.js client backing `getDb()` — same DATABASE_URL authority. */
export function getSharedSqlClient(): ReturnType<typeof postgres> {
  getDb();
  if (!client) {
    throw new Error("Shared postgres client is not initialized");
  }
  return client;
}

export async function closeDb(): Promise<void> {
  if (client) {
    await client.end({ timeout: 5 });
    client = undefined;
    db = undefined;
  }
}

export async function pingDb(connectionString: string): Promise<boolean> {
  const sql = postgres(connectionString, { max: 1, connect_timeout: 5 });
  try {
    const rows = await sql<{ ok: number }[]>`SELECT 1 AS ok`;
    return rows[0]?.ok === 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}
