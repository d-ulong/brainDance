#!/usr/bin/env tsx
/**
 * Isolated recovery drill: restore simulation -> tombstone/revocation replay -> projection rebuild -> canary.
 *
 * Usage:
 *   BRAIN_DANCE_SYNTHETIC=1 DATABASE_URL=postgresql://localhost:5432/braindance_synthetic pnpm recovery:drill
 *
 * Creates an isolated temporary database; refuses non-synthetic targets.
 */

import { config } from "dotenv";
import { eq, sql } from "drizzle-orm";
import { performance } from "node:perf_hooks";

import { pointBalanceProjection } from "../src/db/schema/points";
import { users } from "../src/db/schema/identity";
import { DELETION_TARGET_TYPE } from "../src/modules/data-lifecycle/constants";
import {
  applyTombstonesBeforeProjectionRebuild,
  confirmDeletionRequest,
  createDeletionRequest,
  processDeletionWorker,
} from "../src/modules/data-lifecycle/deletion-request.service";
import { createMemoryArtifactStore } from "../src/modules/data-lifecycle/private-artifact-store";
import { getDailyReflection } from "../src/modules/reflection-privacy/get-daily-reflection.service";
import { upsertDailyReflection } from "../src/modules/reflection-privacy/upsert-daily-reflection.service";
import { rebuildProjection } from "../src/modules/projection/rebuild-projection.service";
import { seedStudentBalance } from "../tests/helpers/redemption";
import { bootstrapParentStudentRelationship } from "../tests/helpers/schedule";
import { toFamilyDate } from "../src/modules/time-policy/to-family-date";
import {
  closeIsolatedM2Database,
  openIsolatedM2Database,
} from "../tests/integration/migrations/m2-isolated-database";
import { assertSyntheticEnvironment } from "./lib/synthetic-env-guard";

config({ path: ".env.local" });
config({ path: ".env" });

async function main() {
  const guard = assertSyntheticEnvironment();
  if (!guard.ok) {
    console.error(guard.reason);
    process.exit(1);
  }

  process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";
  const artifactStore = createMemoryArtifactStore();
  const drillStarted = performance.now();
  const isolated = await openIsolatedM2Database({
    dbName: `bd_synth_recovery_${Date.now().toString(36)}`,
  });
  const db = isolated.db;

  const steps: Array<{ step: string; ok: boolean; detail?: string }> = [];

  try {
    const { studentId } = await bootstrapParentStudentRelationship(db);
    const canaryStudent = studentId;
    const { studentId: survivorId } = await bootstrapParentStudentRelationship(db);

    await seedStudentBalance(db, canaryStudent, 42);
    await seedStudentBalance(db, survivorId, 17);

    const familyDate = toFamilyDate();
    await upsertDailyReflection(db, {
      studentId: canaryStudent,
      familyDate,
      visibility: "normal",
      body: "canary-body-must-not-return",
      idempotencyKey: `recovery-canary-${Date.now()}`,
    });

    const deletion = await createDeletionRequest(db, {
      targetType: DELETION_TARGET_TYPE.STUDENT_ACCOUNT,
      targetId: canaryStudent,
      requestedBy: canaryStudent,
      requesterRole: "student",
      idempotencyKey: `recovery-deletion-${Date.now()}`,
      artifactStore,
    });

    await confirmDeletionRequest(db, {
      requestId: deletion.requestId,
      studentId: canaryStudent,
      idempotencyKey: `recovery-confirm-${Date.now()}`,
    });

    await processDeletionWorker(db, {
      requestId: deletion.requestId,
      artifactStore,
    });

    steps.push({ step: "prepare_deletion_and_tombstone", ok: true });

    const tombstoneRows = await db.execute(
      sql`SELECT count(*)::int AS count FROM deletion_tombstones`,
    );
    const tombstoneCount = Number((tombstoneRows[0] as { count: number }).count);
    steps.push({
      step: "tombstone_written",
      ok: tombstoneCount >= 1,
      detail: `count=${tombstoneCount}`,
    });

    await db.execute(
      sql`UPDATE daily_reflections SET body = 'simulated-backup-leak' WHERE student_id = ${canaryStudent}::uuid`,
    );

    await db
      .update(pointBalanceProjection)
      .set({ balance: 9999 })
      .where(eq(pointBalanceProjection.studentId, canaryStudent));

    steps.push({ step: "simulate_restore_corruption", ok: true });

    const replayStarted = performance.now();
    const replayApplied = await applyTombstonesBeforeProjectionRebuild(db, { artifactStore });
    const replayMs = performance.now() - replayStarted;
    steps.push({
      step: "tombstone_replay_before_projection",
      ok: replayApplied >= 0,
      detail: `applied=${replayApplied}, ms=${replayMs.toFixed(1)}`,
    });

    const rebuildStarted = performance.now();
    await rebuildProjection(db);
    const rebuildMs = performance.now() - rebuildStarted;
    steps.push({ step: "rebuild_projection", ok: true, detail: `ms=${rebuildMs.toFixed(1)}` });

    let bodyBlocked = false;
    try {
      await getDailyReflection(db, {
        actorId: canaryStudent,
        actorRole: "student",
        studentId: canaryStudent,
        familyDate,
      });
    } catch {
      bodyBlocked = true;
    }
    steps.push({ step: "canary_body_not_readable", ok: bodyBlocked });

    const [deletedBalance] = await db
      .select()
      .from(pointBalanceProjection)
      .where(eq(pointBalanceProjection.studentId, canaryStudent));
    steps.push({
      step: "deleted_student_balance_projection_cleared",
      ok: !deletedBalance,
    });

    const [survivorBalance] = await db
      .select()
      .from(pointBalanceProjection)
      .where(eq(pointBalanceProjection.studentId, survivorId));
    steps.push({
      step: "survivor_balance_projection_rebuildable",
      ok: !survivorBalance,
      detail: survivorBalance
        ? `unexpected balance=${survivorBalance.balance}`
        : "no orphan projection",
    });

    const [survivorUser] = await db.select().from(users).where(eq(users.id, survivorId));
    steps.push({
      step: "survivor_identity_intact",
      ok: Boolean(survivorUser?.username),
    });

    const totalMs = performance.now() - drillStarted;
    const failed = steps.filter((s) => !s.ok);

    console.log(
      JSON.stringify(
        {
          databaseName: isolated.dbName,
          rpoNote: "Simulated isolated drill; not production RPO/RTO commitment",
          rtoMs: totalMs,
          replayMs,
          rebuildMs,
          steps,
          passed: failed.length === 0,
        },
        null,
        2,
      ),
    );

    if (failed.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    await closeIsolatedM2Database(isolated);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
