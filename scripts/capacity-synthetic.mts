#!/usr/bin/env tsx
/**
 * Synthetic capacity acceptance for M6 (100 / 1,000 / 10,000 families).
 *
 * Usage:
 *   BRAIN_DANCE_SYNTHETIC=1 DATABASE_URL=postgresql://localhost:5432/<any-local-db> pnpm capacity:synthetic -- --tier 100
 *
 * Creates an isolated temporary database; refuses non-synthetic hosts via synthetic-env-guard.
 */

import { config } from "dotenv";
import { sql } from "drizzle-orm";
import { performance } from "node:perf_hooks";

import { users } from "../src/db/schema/identity";
import {
  createExportJob,
  processExportJob,
} from "../src/modules/data-lifecycle/export-job.service";
import { createMemoryArtifactStore } from "../src/modules/data-lifecycle/private-artifact-store";
import { bootstrapCatalogItem, seedStudentBalance } from "../tests/helpers/redemption";
import { bootstrapParentStudentRelationship } from "../tests/helpers/schedule";
import {
  closeIsolatedM2Database,
  openIsolatedM2Database,
  type IsolatedM2Database,
} from "../tests/integration/migrations/m2-isolated-database";
import { requireSyntheticEnvironment } from "./lib/synthetic-env-guard";

config({ path: ".env.local" });
config({ path: ".env" });

const VALID_TIERS = [100, 1000, 10000] as const;
type Tier = (typeof VALID_TIERS)[number];

function parseTier(): Tier {
  const args = process.argv.slice(2);
  const tierIndex = args.indexOf("--tier");
  if (tierIndex === -1 || !args[tierIndex + 1]) {
    console.error("Usage: pnpm capacity:synthetic -- --tier 100|1000|10000");
    process.exit(1);
  }
  const tier = Number(args[tierIndex + 1]);
  if (!VALID_TIERS.includes(tier as Tier)) {
    console.error(`Invalid tier: ${tier}. Must be one of ${VALID_TIERS.join(", ")}`);
    process.exit(1);
  }
  return tier as Tier;
}

async function countConnections(db: IsolatedM2Database["db"]): Promise<number> {
  const rows = await db.execute(sql`
    SELECT count(*)::int AS count
    FROM pg_stat_activity
    WHERE datname = current_database()
  `);
  return Number((rows[0] as { count: number }).count);
}

async function seedFamilies(db: IsolatedM2Database["db"], tier: Tier) {
  const started = performance.now();

  for (let i = 0; i < tier; i += 1) {
    const suffix = `${tier}-${i}-${Date.now().toString(36)}`;
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);

    await db
      .update(users)
      .set({ contactVerifiedAt: new Date() })
      .where(sql`${users.id} = ${parentId}::uuid`);

    await seedStudentBalance(db, studentId, 50);
    await bootstrapCatalogItem(db, {
      parentId,
      studentId,
      title: `Synthetic reward ${i}`,
      cost: 5,
      idempotencyKey: `synth-catalog-${suffix}`,
    });
  }

  return { seedMs: performance.now() - started, families: tier };
}

async function measureExportThroughput(db: IsolatedM2Database["db"], sampleSize: number) {
  const artifactStore = createMemoryArtifactStore();
  const students = await db.execute(sql`
    SELECT id FROM users WHERE role = 'student' ORDER BY created_at LIMIT ${sampleSize}
  `);

  const started = performance.now();
  let ready = 0;

  for (const row of students as Array<{ id: string }>) {
    const created = await createExportJob(db, {
      requesterId: row.id,
      requesterRole: "student",
      studentId: row.id,
      idempotencyKey: `synth-export-${row.id}-${Date.now()}`,
    });
    const processed = await processExportJob(db, { jobId: created.jobId, artifactStore });
    if (processed.status === "ready") ready += 1;
  }

  const elapsedMs = performance.now() - started;
  return {
    sampleSize,
    ready,
    exportThroughputPerSec: sampleSize / (elapsedMs / 1000),
    exportElapsedMs: elapsedMs,
  };
}

async function main() {
  requireSyntheticEnvironment();
  const tier = parseTier();
  process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";

  const isolated = await openIsolatedM2Database({
    dbName: `bd_synth_capacity_${tier}_${Date.now().toString(36)}`,
  });
  const db = isolated.db;
  const runStarted = performance.now();

  console.log(
    JSON.stringify({
      phase: "start",
      tier,
      databaseName: isolated.dbName,
      at: new Date().toISOString(),
    }),
  );

  try {
    const connectionsBefore = await countConnections(db);
    const seed = await seedFamilies(db, tier);
    const connectionsAfterSeed = await countConnections(db);

    const outboxDepthRows = await db.execute(sql`
      SELECT status, count(*)::int AS count
      FROM outbox_events
      GROUP BY status
    `);
    const queueDepth = Object.fromEntries(
      (outboxDepthRows as Array<{ status: string; count: number }>).map((row) => [
        row.status,
        row.count,
      ]),
    );

    const sampleSize = Math.min(tier, tier >= 1000 ? 20 : 10);
    const exportMetrics = await measureExportThroughput(db, sampleSize);

    const result = {
      tier,
      databaseName: isolated.dbName,
      connections: { before: connectionsBefore, afterSeed: connectionsAfterSeed },
      seed: { families: seed.families, elapsedMs: seed.seedMs },
      queueDepth,
      export: exportMetrics,
      deletionThroughputPerSec: null,
      totalElapsedMs: performance.now() - runStarted,
      note: "Synthetic isolated metrics; not a production capacity guarantee.",
    };

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await closeIsolatedM2Database(isolated);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
