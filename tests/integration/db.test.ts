import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as schema from "@/db/schema";
import { parseEnv, requireDatabaseUrl } from "@/lib/env";

describe("database integration", () => {
  const env = parseEnv(process.env);

  if (env.SKIP_DB_TESTS || !process.env.DATABASE_URL) {
    it.skip("skipped because SKIP_DB_TESTS=true or DATABASE_URL is unset", () => undefined);
    return;
  }

  let connectionString: string;
  let client: ReturnType<typeof postgres> | undefined;

  beforeAll(async () => {
    connectionString = requireDatabaseUrl();
    client = postgres(connectionString, { max: 1 });
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: "./src/db/migrations" });
  });

  afterAll(async () => {
    if (client) {
      await client.end({ timeout: 5 });
    }
  });

  it("connects and reads bootstrap_meta", async () => {
    const db = drizzle(client!, { schema });
    const rows = await db.execute(sql`SELECT COUNT(*)::int AS count FROM _bootstrap_meta`);
    const count = (rows[0] as { count: number }).count;
    expect(count).toBeGreaterThanOrEqual(0);
  });
});
