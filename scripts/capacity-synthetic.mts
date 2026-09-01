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
import path from "node:path";
import os from "node:os";
import { mkdir } from "node:fs/promises";

import { users } from "../src/db/schema/identity";
import {
  createExportJob,
  processExportJob,
} from "../src/modules/data-lifecycle/export-job.service";
import { DELETION_TARGET_TYPE } from "../src/modules/data-lifecycle/constants";
import {
  confirmDeletionRequest,
  createDeletionRequest,
  processDeletionWorker,
} from "../src/modules/data-lifecycle/deletion-request.service";
import { createFilesystemArtifactStore } from "../src/modules/data-lifecycle/private-artifact-store";
import { bootstrapCatalogItem, seedStudentBalance } from "../tests/helpers/redemption";
import { bootstrapParentStudentRelationship } from "../tests/helpers/schedule";
import {
  closeIsolatedM2Database,
  openIsolatedM2Database,
  type IsolatedM2Database,
} from "../tests/integration/migrations/m2-isolated-database";
import {
  parseCapacityTier,
  type CapacityMetricValue,
  unavailableMetric,
} from "./lib/capacity-metrics";
import { requireSyntheticEnvironment } from "./lib/synthetic-env-guard";

config({ path: ".env.local" });
config({ path: ".env" });

async function countConnections(db: IsolatedM2Database["db"]): Promise<number> {
  const rows = await db.execute(sql`
    SELECT count(*)::int AS count
    FROM pg_stat_activity
    WHERE datname = current_database()
  `);
  return Number((rows[0] as { count: number }).count);
}

async function measureSlowQueries(db: IsolatedM2Database["db"]): Promise<CapacityMetricValue> {
  try {
    const extension = await db.execute(sql`
      SELECT 1 AS ok
      FROM pg_extension
      WHERE extname = 'pg_stat_statements'
      LIMIT 1
    `);
    if (extension.length === 0) {
      return unavailableMetric("pg_stat_statements extension is not installed");
    }

    const rows = await db.execute(sql`
      SELECT
        count(*)::int AS statements,
        coalesce(max(mean_exec_time), 0)::float8 AS maxMeanExecMs,
        coalesce(sum(calls), 0)::bigint AS totalCalls
      FROM pg_stat_statements
      WHERE mean_exec_time >= 50
    `);
    const row = rows[0] as {
      statements: number;
      maxMeanExecMs: number;
      totalCalls: string | number;
    };
    return {
      status: "measured",
      value: {
        statementsOver50ms: Number(row.statements),
        maxMeanExecMs: Number(row.maxMeanExecMs),
        totalCalls: Number(row.totalCalls),
        thresholdMs: 50,
      },
    };
  } catch (error) {
    return unavailableMetric(
      error instanceof Error ? error.message : "failed to query slow-query metrics",
    );
  }
}

function measureResourceBoundary(): CapacityMetricValue {
  try {
    const memory = process.memoryUsage();
    return {
      status: "measured",
      value: {
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        heapTotalBytes: memory.heapTotal,
        externalBytes: memory.external,
        freememBytes: os.freemem(),
        totalmemBytes: os.totalmem(),
        loadavg: os.loadavg(),
        note: "Process/OS snapshot at capacity run end; not a production SLO.",
      },
    };
  } catch (error) {
    return unavailableMetric(
      error instanceof Error ? error.message : "failed to read process resource metrics",
    );
  }
}

async function seedFamilies(db: IsolatedM2Database["db"], tier: number) {
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

async function measureExportThroughput(
  db: IsolatedM2Database["db"],
  sampleSize: number,
  artifactRoot: string,
) {
  const artifactStore = createFilesystemArtifactStore(artifactRoot);
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
    status: "measured" as const,
    value: {
      sampleSize,
      ready,
      exportThroughputPerSec: sampleSize / (elapsedMs / 1000),
      exportElapsedMs: elapsedMs,
    },
  };
}

async function measureDeletionThroughput(
  db: IsolatedM2Database["db"],
  sampleSize: number,
  artifactRoot: string,
): Promise<CapacityMetricValue> {
  const artifactStore = createFilesystemArtifactStore(path.join(artifactRoot, "deletion"));
  const students = await db.execute(sql`
    SELECT id FROM users WHERE role = 'student' ORDER BY created_at DESC LIMIT ${sampleSize}
  `);

  if ((students as Array<{ id: string }>).length === 0) {
    return unavailableMetric("no student rows available for deletion throughput sample");
  }

  const started = performance.now();
  let executed = 0;

  for (const row of students as Array<{ id: string }>) {
    const deletion = await createDeletionRequest(db, {
      targetType: DELETION_TARGET_TYPE.STUDENT_ACCOUNT,
      targetId: row.id,
      requestedBy: row.id,
      requesterRole: "student",
      idempotencyKey: `synth-deletion-${row.id}-${Date.now()}`,
      artifactStore,
    });
    await confirmDeletionRequest(db, {
      requestId: deletion.requestId,
      studentId: row.id,
      idempotencyKey: `synth-confirm-${row.id}-${Date.now()}`,
    });
    const result = await processDeletionWorker(db, {
      requestId: deletion.requestId,
      artifactStore,
    });
    if (result.status === "executed") executed += 1;
  }

  const elapsedMs = performance.now() - started;
  return {
    status: "measured",
    value: {
      sampleSize: (students as Array<{ id: string }>).length,
      executed,
      deletionThroughputPerSec: executed / (elapsedMs / 1000),
      deletionElapsedMs: elapsedMs,
    },
  };
}

async function main() {
  requireSyntheticEnvironment();
  let tier: number;
  try {
    tier = parseCapacityTier(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
  process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";

  const isolated = await openIsolatedM2Database({
    dbName: `bd_synth_capacity_${tier}_${Date.now().toString(36)}`,
  });
  const db = isolated.db;
  const runStarted = performance.now();
  const artifactRoot = path.join(
    process.cwd(),
    ".braindance-artifacts",
    "capacity",
    isolated.dbName,
  );
  await mkdir(artifactRoot, { recursive: true });

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
    const exportMetrics = await measureExportThroughput(db, sampleSize, artifactRoot);
    const deletionSample = Math.min(3, sampleSize);
    const deletionMetrics = await measureDeletionThroughput(db, deletionSample, artifactRoot);
    const slowQueries = await measureSlowQueries(db);
    const resources = measureResourceBoundary();

    const result = {
      tier,
      databaseName: isolated.dbName,
      connections: {
        status: "measured",
        value: { before: connectionsBefore, afterSeed: connectionsAfterSeed },
      },
      seed: { families: seed.families, elapsedMs: seed.seedMs },
      queueDepth: { status: "measured", value: queueDepth },
      slowQueries,
      export: exportMetrics,
      deletion: deletionMetrics,
      resources,
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
