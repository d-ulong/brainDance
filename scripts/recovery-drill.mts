#!/usr/bin/env tsx
/**
 * Isolated recovery drill with PostgreSQL CREATE DATABASE ... TEMPLATE snapshot restore,
 * tombstone-before-projection, and canary.
 *
 * Usage:
 *   BRAIN_DANCE_SYNTHETIC=1 DATABASE_URL=postgresql://localhost:5432/braindance_synthetic pnpm recovery:drill
 */

import { config } from "dotenv";
import { and, eq, sql } from "drizzle-orm";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

import * as schema from "../src/db/schema";
import { pointBalanceProjection } from "../src/db/schema/points";
import { pointRedemptions } from "../src/db/schema/redemption";
import { privateAccessGrants } from "../src/db/schema/reflection-privacy";
import { users } from "../src/db/schema/identity";
import { DELETION_TARGET_TYPE } from "../src/modules/data-lifecycle/constants";
import {
  applyTombstonesBeforeProjectionRebuild,
  confirmDeletionRequest,
  createDeletionRequest,
  processDeletionWorker,
} from "../src/modules/data-lifecycle/deletion-request.service";
import { createFilesystemArtifactStore } from "../src/modules/data-lifecycle/private-artifact-store";
import { getDailyReflection } from "../src/modules/reflection-privacy/get-daily-reflection.service";
import { grantPrivateAccess } from "../src/modules/reflection-privacy/grant-private-access.service";
import { upsertDailyReflection } from "../src/modules/reflection-privacy/upsert-daily-reflection.service";
import { rebuildProjection } from "../src/modules/projection/rebuild-projection.service";
import {
  approveRedemptionRequest,
  createRedemptionRequest,
} from "../src/modules/redemption/redemption.service";
import { bootstrapCatalogItem, seedStudentBalance } from "../tests/helpers/redemption";
import { bootstrapParentStudentRelationship } from "../tests/helpers/schedule";
import { toFamilyDate } from "../src/modules/time-policy/to-family-date";
import {
  adminDatabaseUrl,
  closeIsolatedM2Database,
  databaseUrlForName,
  openIsolatedM2Database,
} from "../tests/integration/migrations/m2-isolated-database";
import { assertSyntheticEnvironment } from "./lib/synthetic-env-guard";

config({ path: ".env.local" });
config({ path: ".env" });

type Step = { step: string; ok: boolean; detail?: string };

async function main() {
  const guard = assertSyntheticEnvironment();
  if (!guard.ok) {
    console.error(guard.reason);
    process.exit(1);
  }

  process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";
  const drillStarted = performance.now();
  const steps: Step[] = [];
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "bd-recovery-"));
  const artifactRoot = path.join(tempDir, "artifacts");
  await mkdir(artifactRoot, { recursive: true });
  const artifactStore = createFilesystemArtifactStore(artifactRoot);
  const isolated = await openIsolatedM2Database({
    dbName: `bd_synth_recovery_${Date.now().toString(36)}`,
  });
  let db = isolated.db;
  let client = isolated.client;
  const rootUrl = process.env.DATABASE_URL!;
  const databaseUrl = databaseUrlForName(rootUrl, isolated.dbName);
  const backupDbName = `${isolated.dbName}_bak`;
  let backupMs = 0;
  let restoreMs = 0;
  let rtoStarted = 0;
  let canaryStarted = 0;

  try {
    const familyDate = toFamilyDate();
    const canary = await bootstrapParentStudentRelationship(db);
    const survivor = await bootstrapParentStudentRelationship(db);

    await seedStudentBalance(db, canary.studentId, 42);
    await seedStudentBalance(db, survivor.studentId, 17);

    await upsertDailyReflection(db, {
      studentId: canary.studentId,
      familyDate,
      visibility: "normal",
      body: "canary-body-must-not-return",
      idempotencyKey: `recovery-canary-${Date.now()}`,
    });

    await upsertDailyReflection(db, {
      studentId: survivor.studentId,
      familyDate,
      visibility: "private",
      body: "survivor-private-body-keep",
      idempotencyKey: `recovery-survivor-private-${Date.now()}`,
    });

    await grantPrivateAccess(db, {
      studentId: survivor.studentId,
      parentId: survivor.parentId,
      familyDate,
      idempotencyKey: `recovery-survivor-grant-${Date.now()}`,
    });

    const revokedFamilyDate = toFamilyDate(new Date(Date.now() - 86_400_000));
    const revokedReflectionRows = await db.execute(sql`
      INSERT INTO daily_reflections (student_id, family_date, visibility, body, current_version)
      VALUES (${survivor.studentId}::uuid, ${revokedFamilyDate}::date, 'private', 'revoked-grant-body', 1)
      RETURNING id
    `);
    const revokedReflectionId = (revokedReflectionRows[0] as { id: string }).id;
    await db.execute(sql`
      INSERT INTO private_access_grants (resource_type, resource_id, parent_id, revoked_at)
      VALUES (
        'daily_reflection',
        ${revokedReflectionId}::uuid,
        ${survivor.parentId}::uuid,
        now() - interval '1 day'
      )
    `);

    const catalog = await bootstrapCatalogItem(db, {
      parentId: survivor.parentId,
      studentId: survivor.studentId,
      title: "Recovery reward",
      cost: 5,
      idempotencyKey: `recovery-catalog-${Date.now()}`,
    });
    const redemption = await createRedemptionRequest(db, {
      studentId: survivor.studentId,
      actorId: survivor.studentId,
      catalogItemId: catalog.item.id,
      idempotencyKey: `recovery-redemption-${Date.now()}`,
    });
    await approveRedemptionRequest(db, {
      studentId: survivor.studentId,
      redemptionId: redemption.redemption.id,
      parentId: survivor.parentId,
      idempotencyKey: `recovery-approve-${Date.now()}`,
    });

    const deletion = await createDeletionRequest(db, {
      targetType: DELETION_TARGET_TYPE.STUDENT_ACCOUNT,
      targetId: canary.studentId,
      requestedBy: canary.studentId,
      requesterRole: "student",
      idempotencyKey: `recovery-deletion-${Date.now()}`,
      artifactStore,
    });
    await confirmDeletionRequest(db, {
      requestId: deletion.requestId,
      studentId: canary.studentId,
      idempotencyKey: `recovery-confirm-${Date.now()}`,
    });
    await processDeletionWorker(db, {
      requestId: deletion.requestId,
      artifactStore,
    });
    // Align projections with ledger before snapshot so restore/rebuild canary is meaningful.
    await rebuildProjection(db);
    const [expectedSurvivorBalance] = await db
      .select()
      .from(pointBalanceProjection)
      .where(eq(pointBalanceProjection.studentId, survivor.studentId));
    steps.push({
      step: "prepare_deletion_tombstone_and_revocation",
      ok: true,
      detail: `expectedSurvivorBalance=${expectedSurvivorBalance?.balance ?? "missing"}`,
    });

    const watermarkRows = await db.execute(sql`
      SELECT coalesce(max(occurred_at), now()) AS watermark FROM audit_events
    `);
    const recoveryPointAt = new Date(
      (watermarkRows[0] as { watermark: string | Date }).watermark,
    ).toISOString();
    const recoveryPointEpochMs = Date.parse(recoveryPointAt);

    await client.end({ timeout: 5 });
    const backupStarted = performance.now();
    const adminForBackup = postgres(adminDatabaseUrl(rootUrl), { max: 1 });
    try {
      await adminForBackup.unsafe(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${isolated.dbName}' AND pid <> pg_backend_pid()`,
      );
      await adminForBackup.unsafe(`DROP DATABASE IF EXISTS "${backupDbName}"`);
      await adminForBackup.unsafe(
        `CREATE DATABASE "${backupDbName}" TEMPLATE "${isolated.dbName}"`,
      );
    } finally {
      await adminForBackup.end({ timeout: 5 });
    }
    backupMs = performance.now() - backupStarted;
    steps.push({
      step: "backup_create_database_template",
      ok: true,
      detail: `ms=${backupMs.toFixed(1)}; recoveryPointAt=${recoveryPointAt}; backupDb=${backupDbName}`,
    });

    client = postgres(databaseUrl, { max: 5 });
    db = drizzle(client, { schema }) as typeof db;
    isolated.client = client;
    isolated.db = db;

    const postBackupWriteAt = new Date().toISOString();
    await db.execute(sql`
      INSERT INTO audit_events (
        actor_id, action, resource_type, resource_id, idempotency_key, metadata
      ) VALUES (
        ${survivor.studentId}::uuid,
        'recovery.post_backup_marker',
        'recovery_drill',
        ${survivor.studentId}::uuid,
        ${`recovery-post-backup-${Date.now()}`},
        ${JSON.stringify({ body: "post-backup-write-should-be-lost" })}::jsonb
      )
    `);
    steps.push({
      step: "post_backup_write",
      ok: true,
      detail: `postBackupWriteAt=${postBackupWriteAt}`,
    });

    await client.end({ timeout: 5 });

    // RTO starts at the recovery/restore start point (F05): fixture preparation and
    // backup creation are intentionally excluded.
    rtoStarted = performance.now();
    const restoreStarted = performance.now();
    const adminForRestore = postgres(adminDatabaseUrl(rootUrl), { max: 1 });
    try {
      await adminForRestore.unsafe(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${isolated.dbName}' AND pid <> pg_backend_pid()`,
      );
      await adminForRestore.unsafe(`DROP DATABASE IF EXISTS "${isolated.dbName}"`);
      await adminForRestore.unsafe(
        `CREATE DATABASE "${isolated.dbName}" TEMPLATE "${backupDbName}"`,
      );
      await adminForRestore.unsafe(`DROP DATABASE IF EXISTS "${backupDbName}"`);
    } finally {
      await adminForRestore.end({ timeout: 5 });
    }
    restoreMs = performance.now() - restoreStarted;
    steps.push({
      step: "restore_from_template_complete",
      ok: true,
      detail: `ms=${restoreMs.toFixed(1)}`,
    });

    client = postgres(databaseUrl, { max: 5 });
    db = drizzle(client, { schema }) as typeof db;
    isolated.client = client;
    isolated.db = db;

    await db.execute(
      sql`UPDATE daily_reflections SET body = 'simulated-backup-leak', deleted_at = NULL, body_purged_at = NULL WHERE student_id = ${canary.studentId}::uuid`,
    );
    await db
      .update(pointBalanceProjection)
      .set({ balance: 9999 })
      .where(eq(pointBalanceProjection.studentId, canary.studentId));
    steps.push({ step: "inject_post_restore_backup_leak_for_canary", ok: true });

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

    // Canary phase starts once the projection is rebuilt (included in RTO).
    canaryStarted = performance.now();

    let bodyBlocked = false;
    try {
      await getDailyReflection(db, {
        actorId: canary.studentId,
        actorRole: "student",
        studentId: canary.studentId,
        familyDate,
      });
    } catch {
      bodyBlocked = true;
    }
    steps.push({ step: "canary_deleted_body_not_readable", ok: bodyBlocked });

    const [revokedGrant] = await db
      .select()
      .from(privateAccessGrants)
      .where(
        and(
          eq(privateAccessGrants.resourceId, revokedReflectionId),
          eq(privateAccessGrants.parentId, survivor.parentId),
        ),
      )
      .limit(1);
    steps.push({
      step: "canary_revoked_authorization_not_restored",
      ok: Boolean(revokedGrant?.revokedAt),
      detail: revokedGrant ? `revokedAt=${revokedGrant.revokedAt?.toISOString()}` : "missing grant",
    });

    const activeGrantRows = await db.execute(sql`
      SELECT g.id, g.revoked_at
      FROM private_access_grants g
      INNER JOIN daily_reflections r ON r.id = g.resource_id
      WHERE r.student_id = ${survivor.studentId}::uuid
        AND r.family_date = ${familyDate}::date
        AND g.parent_id = ${survivor.parentId}::uuid
      LIMIT 1
    `);
    const activeGrant = activeGrantRows[0] as { id: string; revoked_at: string | null } | undefined;
    steps.push({
      step: "canary_undeleted_authorization_matrix_intact",
      ok: Boolean(activeGrant && !activeGrant.revoked_at),
    });

    const [survivorBalance] = await db
      .select()
      .from(pointBalanceProjection)
      .where(eq(pointBalanceProjection.studentId, survivor.studentId));
    steps.push({
      step: "canary_survivor_balance_consistent",
      ok: survivorBalance?.balance === (expectedSurvivorBalance?.balance ?? null),
      detail: survivorBalance
        ? `balance=${survivorBalance.balance}; expected=${expectedSurvivorBalance?.balance}`
        : "missing",
    });

    const [deletedBalance] = await db
      .select()
      .from(pointBalanceProjection)
      .where(eq(pointBalanceProjection.studentId, canary.studentId));
    steps.push({
      step: "canary_deleted_balance_cleared",
      ok: !deletedBalance,
    });

    const redemptions = await db
      .select()
      .from(pointRedemptions)
      .where(eq(pointRedemptions.studentId, survivor.studentId));
    steps.push({
      step: "canary_redemption_history_intact",
      ok: redemptions.some(
        (row) => row.status === "approved" && row.id === redemption.redemption.id,
      ),
      detail: `count=${redemptions.length}`,
    });

    let survivorBodyOk = false;
    try {
      const reflection = await getDailyReflection(db, {
        actorId: survivor.studentId,
        actorRole: "student",
        studentId: survivor.studentId,
        familyDate,
      });
      survivorBodyOk = reflection.body === "survivor-private-body-keep";
    } catch {
      survivorBodyOk = false;
    }
    steps.push({ step: "canary_undeleted_body_intact", ok: survivorBodyOk });

    const [survivorUser] = await db.select().from(users).where(eq(users.id, survivor.studentId));
    steps.push({
      step: "canary_undeleted_identity_intact",
      ok: Boolean(survivorUser?.username),
    });

    const lostWriteRows = await db.execute(sql`
      SELECT count(*)::int AS count
      FROM audit_events
      WHERE action = 'recovery.post_backup_marker'
    `);
    const lostWriteCount = Number((lostWriteRows[0] as { count: number }).count);
    const observedRpoMs = Math.max(0, Date.parse(postBackupWriteAt) - recoveryPointEpochMs);
    steps.push({
      step: "observed_rpo_from_lost_post_backup_write",
      ok: lostWriteCount === 0 && observedRpoMs >= 0,
      detail: `lostWriteCount=${lostWriteCount}; observedRpoMs=${observedRpoMs}`,
    });

    const totalMs = performance.now() - drillStarted;
    const canaryMs = canaryStarted ? performance.now() - canaryStarted : 0;
    const totalRtoMs = rtoStarted ? performance.now() - rtoStarted : 0;
    const failed = steps.filter((s) => !s.ok);
    const report = {
      databaseName: isolated.dbName,
      nonProductionDeclaration:
        "Isolated synthetic drill only; not a production RPO/RTO commitment.",
      recoveryPoint: {
        method:
          "PostgreSQL CREATE DATABASE ... TEMPLATE snapshot after deletion/tombstone/revocation facts; watermark = max(audit_events.occurred_at) immediately before backup; intentional post-backup write must be lost after restore",
        recoveryPointAt,
        unit: "ISO-8601 timestamp / milliseconds",
      },
      rpo: {
        observedRpoMs,
        unit: "ms",
        meaning:
          "Age of the intentional post-backup write lost after restore, relative to the recovery-point watermark",
      },
      rto: {
        rtoStartedAt: rtoStarted
          ? new Date(rtoStarted + performance.timeOrigin).toISOString()
          : null,
        meaning:
          "Elapsed from the restore start point through restore, tombstone/revocation replay, projection rebuild and canary; fixture preparation and backup creation are excluded (F05)",
        restoreMs,
        replayMs,
        rebuildMs,
        canaryMs,
        totalRtoMs,
        unit: "ms",
      },
      totalDrillMs: totalMs,
      steps,
      passed: failed.length === 0,
    };

    await writeFile(path.join(tempDir, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));

    if (failed.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    try {
      const adminCleanup = postgres(adminDatabaseUrl(rootUrl), { max: 1 });
      try {
        await adminCleanup.unsafe(`DROP DATABASE IF EXISTS "${backupDbName}"`);
      } finally {
        await adminCleanup.end({ timeout: 5 });
      }
    } catch {
      // ignore
    }
    try {
      await closeIsolatedM2Database(isolated);
    } catch {
      // ignore
    }
    await rm(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
