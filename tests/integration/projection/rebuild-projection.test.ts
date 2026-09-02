import { config } from "dotenv";
import { asc, eq, sql } from "drizzle-orm";
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { auditEvents, outboxEvents, pointBalanceProjection, pointLedgerEntries } from "@/db/schema";
import { confirmFact } from "@/modules/facts/confirm-fact.service";
import { submitErrorCount } from "@/modules/facts/submit-error-count.service";
import { createFormalPlan } from "@/modules/schedule/plan.service";
import { maintainHorizon } from "@/modules/schedule/maintain-horizon.service";
import { scheduleItems } from "@/db/schema";
import { rebuildProjection } from "@/modules/projection/rebuild-projection.service";
import { loadOrderedLedgerEntriesForStudent } from "@/modules/settlement/ledger-order";
import { closeTestDb, getTestDb, migrateTestDb, resetIdentityTables } from "../../helpers/db";
import { seedRebuildSafeStudentBalance } from "../../helpers/redemption";
import {
  bootstrapParentStudentRelationship,
  DEFAULT_PLAN_BODY,
  enableErrorCountPointRule,
} from "../../helpers/schedule";

config({ path: ".env.local" });
config({ path: ".env" });

const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);
const WITHIN_WINDOW_NOW = new Date("2026-01-05T04:00:00.000Z");

async function resetLedgerTables(db: ReturnType<typeof getTestDb>) {
  await db.execute(sql`
    TRUNCATE TABLE point_balance_projection, point_ledger_entries, settlements, fact_versions RESTART IDENTITY CASCADE
  `);
}

async function seedRewardedStudent(db: ReturnType<typeof getTestDb>) {
  const linked = await bootstrapParentStudentRelationship(db);
  await enableErrorCountPointRule(db, linked);

  await createFormalPlan(db, {
    ownerId: linked.parentId,
    studentId: linked.studentId,
    idempotencyKey: `plan-rebuild-${linked.suffix}`,
    body: DEFAULT_PLAN_BODY,
    now: WITHIN_WINDOW_NOW,
  });

  await maintainHorizon(db, {
    actorId: linked.parentId,
    studentId: linked.studentId,
    idempotencyKey: `horizon-rebuild-${linked.suffix}`,
    now: WITHIN_WINDOW_NOW,
  });

  const [item] = await db
    .select()
    .from(scheduleItems)
    .where(eq(scheduleItems.studentId, linked.studentId))
    .orderBy(asc(scheduleItems.familyDate))
    .limit(1);

  if (!item) {
    throw new Error("Schedule item missing for rebuild test");
  }

  const submitted = await submitErrorCount(db, {
    actorId: linked.studentId,
    scheduleItemId: item.id,
    idempotencyKey: "rebuild-submit",
    body: { errorCount: 1 },
    now: WITHIN_WINDOW_NOW,
  });

  await confirmFact(db, {
    parentId: linked.parentId,
    factId: submitted.factVersionId,
    idempotencyKey: "rebuild-confirm",
    now: WITHIN_WINDOW_NOW,
  });

  return linked;
}

describe.skipIf(!hasDb)("m3 projection rebuild cli", () => {
  const db = getTestDb();

  beforeAll(async () => {
    await migrateTestDb();
  });

  beforeEach(async () => {
    await resetIdentityTables(db);
    await resetLedgerTables(db);
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("P4-01 rebuilds student balance from ledger totals", async () => {
    const linked = await seedRewardedStudent(db);

    await db.execute(
      sql`DELETE FROM point_balance_projection WHERE student_id = ${linked.studentId}::uuid`,
    );

    const result = await rebuildProjection(db, { studentId: linked.studentId });
    expect(result.studentsRebuilt).toBe(1);
    expect(result.ledgerEntriesScanned).toBe(1);

    const [projection] = await db
      .select()
      .from(pointBalanceProjection)
      .where(eq(pointBalanceProjection.studentId, linked.studentId));

    expect(projection?.balance).toBe(10);
    expect(projection?.lastLedgerEntryId).toBeTruthy();
  });

  it("P4-02 targeted rebuild has no audit/outbox/ledger side effects", async () => {
    const { studentId } = await bootstrapParentStudentRelationship(db);

    const auditBefore = await db.select().from(auditEvents);
    const outboxBefore = await db.select().from(outboxEvents);
    const ledgerBefore = await db.select().from(pointLedgerEntries);

    await rebuildProjection(db, { studentId });

    const auditAfter = await db.select().from(auditEvents);
    const outboxAfter = await db.select().from(outboxEvents);
    const ledgerAfter = await db.select().from(pointLedgerEntries);

    expect(auditAfter.length).toBe(auditBefore.length);
    expect(outboxAfter.length).toBe(outboxBefore.length);
    expect(ledgerAfter.length).toBe(ledgerBefore.length);
  });

  it("R07-01 rebuild last entry matches created_at ordering not random uuid", async () => {
    const linked = await seedRewardedStudent(db);
    const ordered = await loadOrderedLedgerEntriesForStudent(db, linked.studentId);
    expect(ordered).toHaveLength(1);

    await db.execute(
      sql`DELETE FROM point_balance_projection WHERE student_id = ${linked.studentId}::uuid`,
    );

    await rebuildProjection(db, { studentId: linked.studentId });

    const [projection] = await db
      .select()
      .from(pointBalanceProjection)
      .where(eq(pointBalanceProjection.studentId, linked.studentId));

    expect(projection?.lastLedgerEntryId).toBe(ordered.at(-1)?.id);
  });

  it("R07-02 full rebuild removes stale projection rows", async () => {
    const linked = await seedRewardedStudent(db);
    const staleStudent = (await bootstrapParentStudentRelationship(db)).studentId;

    await db.insert(pointBalanceProjection).values({
      studentId: staleStudent,
      balance: 999,
      lastLedgerEntryId: null,
      updatedAt: WITHIN_WINDOW_NOW,
    });

    const result = await rebuildProjection(db);
    expect(result.staleProjectionsRemoved).toBe(1);

    const staleRows = await db
      .select()
      .from(pointBalanceProjection)
      .where(eq(pointBalanceProjection.studentId, staleStudent));
    expect(staleRows).toHaveLength(0);

    const liveRows = await db
      .select()
      .from(pointBalanceProjection)
      .where(eq(pointBalanceProjection.studentId, linked.studentId));
    expect(liveRows).toHaveLength(1);
    expect(liveRows[0]?.balance).toBe(10);
  });

  it("R07-03 repeat rebuild is idempotent", async () => {
    const linked = await seedRewardedStudent(db);

    const first = await rebuildProjection(db, { studentId: linked.studentId });
    const second = await rebuildProjection(db, { studentId: linked.studentId });

    expect(first).toEqual(second);

    const [projection] = await db
      .select()
      .from(pointBalanceProjection)
      .where(eq(pointBalanceProjection.studentId, linked.studentId));
    expect(projection?.balance).toBe(10);
  });

  it("rebuild-safe seed keeps balance after projection rebuild", async () => {
    const linked = await bootstrapParentStudentRelationship(db);
    const seeded = await seedRebuildSafeStudentBalance(db, {
      parentId: linked.parentId,
      studentId: linked.studentId,
      balance: 100,
    });

    await db.execute(
      sql`UPDATE point_balance_projection SET balance = 1 WHERE student_id = ${linked.studentId}::uuid`,
    );

    const result = await rebuildProjection(db, { studentId: linked.studentId });
    expect(result.ledgerEntriesScanned).toBe(1);

    const [projection] = await db
      .select()
      .from(pointBalanceProjection)
      .where(eq(pointBalanceProjection.studentId, linked.studentId));
    expect(projection?.balance).toBe(100);
    expect(projection?.lastLedgerEntryId).toBe(seeded.ledgerEntryId);
  });

  it("R07-04 CLI rejects invalid student-id without leaking database errors", () => {
    try {
      execFileSync("tsx scripts/rebuild-projection.ts --student-id not-a-uuid", {
        encoding: "utf8",
        stdio: "pipe",
        shell: true,
      });
      throw new Error("Expected CLI failure");
    } catch (error) {
      const err = error as { stderr?: string; stdout?: string; message?: string; status?: number };
      expect(err.status).not.toBe(0);
      const combined = `${err.stderr ?? ""}${err.stdout ?? ""}${err.message ?? ""}`;
      expect(combined).toContain("Invalid student-id");
      expect(combined.toLowerCase()).not.toContain("postgres");
      expect(combined.toLowerCase()).not.toContain("sql");
    }
  });
});
