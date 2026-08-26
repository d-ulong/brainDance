import path from "node:path";

import { config } from "dotenv";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  closeIsolatedM2Database,
  databaseExists,
  openIsolatedM2Database,
  type IsolatedM2CleanupStep,
} from "./m2-isolated-database";

config({ path: ".env.local" });
config({ path: ".env" });

const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);

function uniqueDbName(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

describe.skipIf(!hasDb)("m2 isolated database lifecycle (F-R4)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rolls back temp database when migration fails after CREATE DATABASE", async () => {
    const dbName = uniqueDbName("bd_m2_fr4_migfail");
    const disposeSteps: IsolatedM2CleanupStep[] = [];

    await expect(
      openIsolatedM2Database({
        dbName,
        migrationsFolder: path.join(process.cwd(), "does-not-exist-migrations"),
        onDisposeStep: (step, outcome) => {
          if (outcome === "ok") {
            disposeSteps.push(step);
          }
        },
      }),
    ).rejects.toThrow();

    expect(disposeSteps).toContain("drop");
    expect(disposeSteps).toContain("admin.end");
    expect(await databaseExists(dbName)).toBe(false);
  });

  it("continues DROP and admin.end when client.end fails during close", async () => {
    const dbName = uniqueDbName("bd_m2_fr4_close_client");
    const isolated = await openIsolatedM2Database({ dbName });
    const disposeSteps: IsolatedM2CleanupStep[] = [];

    vi.spyOn(isolated.client, "end").mockRejectedValueOnce(new Error("client.end failed"));

    await closeIsolatedM2Database(isolated, {
      onStep: (step, outcome) => {
        if (outcome === "ok") {
          disposeSteps.push(step);
        }
      },
    });

    expect(disposeSteps).toContain("drop");
    expect(disposeSteps).toContain("admin.end");
    expect(await databaseExists(dbName)).toBe(false);
  });

  it("continues DROP and admin.end when terminate fails during close", async () => {
    const dbName = uniqueDbName("bd_m2_fr4_close_term");
    const isolated = await openIsolatedM2Database({ dbName });
    const disposeSteps: IsolatedM2CleanupStep[] = [];
    const originalUnsafe = isolated.admin.unsafe.bind(isolated.admin);

    vi.spyOn(isolated.admin, "unsafe").mockImplementation((query, ...args) => {
      if (typeof query === "string" && query.includes("pg_terminate_backend")) {
        throw new Error("terminate failed");
      }
      return originalUnsafe(query, ...args);
    });

    await closeIsolatedM2Database(isolated, {
      onStep: (step, outcome) => {
        if (outcome === "ok") {
          disposeSteps.push(step);
        }
      },
    });

    expect(disposeSteps).toContain("drop");
    expect(disposeSteps).toContain("admin.end");
    expect(await databaseExists(dbName)).toBe(false);
  });
});
