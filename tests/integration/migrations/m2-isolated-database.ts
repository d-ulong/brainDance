import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import * as schema from "@/db/schema";

import type { TestDb } from "../../helpers/db";

export type IsolatedM2Database = {
  db: TestDb;
  client: ReturnType<typeof postgres>;
  admin: ReturnType<typeof postgres>;
  dbName: string;
};

export type IsolatedM2CleanupStep = "client.end" | "terminate" | "drop" | "admin.end";

type IsolatedM2CleanupTargets = {
  admin: ReturnType<typeof postgres>;
  dbName: string;
  client?: ReturnType<typeof postgres>;
};

type IsolatedM2CleanupHooks = {
  onStep?: (step: IsolatedM2CleanupStep, outcome: "ok" | "error") => void;
};

export type OpenIsolatedM2DatabaseOptions = {
  dbName?: string;
  migrationsFolder?: string;
  onDisposeStep?: (step: IsolatedM2CleanupStep, outcome: "ok" | "error") => void;
};

export function adminDatabaseUrl(connectionString: string): string {
  const url = new URL(connectionString);
  url.pathname = "/postgres";
  return url.toString();
}

export function databaseUrlForName(connectionString: string, name: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${name}`;
  return url.toString();
}

async function migrateFolder(connectionString: string, folder: string): Promise<void> {
  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client);
  try {
    await migrate(db, { migrationsFolder: folder });
  } finally {
    try {
      await client.end({ timeout: 5 });
    } catch {
      // continue
    }
  }
}

export async function disposeIsolatedM2DatabaseResources(
  targets: IsolatedM2CleanupTargets,
  hooks?: IsolatedM2CleanupHooks,
): Promise<void> {
  if (targets.client) {
    try {
      await targets.client.end({ timeout: 5 });
      hooks?.onStep?.("client.end", "ok");
    } catch {
      hooks?.onStep?.("client.end", "error");
    }
  }

  try {
    await targets.admin.unsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${targets.dbName}' AND pid <> pg_backend_pid()`,
    );
    hooks?.onStep?.("terminate", "ok");
  } catch {
    hooks?.onStep?.("terminate", "error");
  }

  try {
    await targets.admin.unsafe(`DROP DATABASE IF EXISTS "${targets.dbName}"`);
    hooks?.onStep?.("drop", "ok");
  } catch {
    hooks?.onStep?.("drop", "error");
  }

  try {
    await targets.admin.end({ timeout: 5 });
    hooks?.onStep?.("admin.end", "ok");
  } catch {
    hooks?.onStep?.("admin.end", "error");
  }
}

export async function openIsolatedM2Database(
  options?: OpenIsolatedM2DatabaseOptions,
): Promise<IsolatedM2Database> {
  const rootUrl = process.env.DATABASE_URL!;
  const dbName =
    options?.dbName ?? `bd_m2_constraints_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const admin = postgres(adminDatabaseUrl(rootUrl), { max: 1 });
  let client: ReturnType<typeof postgres> | undefined;
  const disposeHooks = options?.onDisposeStep ? { onStep: options.onDisposeStep } : undefined;

  try {
    await admin.unsafe(`CREATE DATABASE "${dbName}"`);
  } catch (error) {
    try {
      await admin.end({ timeout: 5 });
    } catch {
      // continue
    }
    throw error;
  }

  const databaseUrl = databaseUrlForName(rootUrl, dbName);
  try {
    await migrateFolder(databaseUrl, options?.migrationsFolder ?? "./src/db/migrations");
    client = postgres(databaseUrl, { max: 5 });
    const db = drizzle(client, { schema }) as TestDb;
    return { db, client, admin, dbName };
  } catch (error) {
    await disposeIsolatedM2DatabaseResources({ admin, dbName, client }, disposeHooks);
    throw error;
  }
}

export async function closeIsolatedM2Database(
  isolated: IsolatedM2Database,
  hooks?: IsolatedM2CleanupHooks,
): Promise<void> {
  await disposeIsolatedM2DatabaseResources(
    { admin: isolated.admin, dbName: isolated.dbName, client: isolated.client },
    hooks,
  );
}

export async function databaseExists(dbName: string): Promise<boolean> {
  const rootUrl = process.env.DATABASE_URL!;
  const admin = postgres(adminDatabaseUrl(rootUrl), { max: 1 });
  try {
    const rows = await admin`
      SELECT 1 FROM pg_database WHERE datname = ${dbName}
    `;
    return rows.length > 0;
  } finally {
    try {
      await admin.end({ timeout: 5 });
    } catch {
      // continue
    }
  }
}
