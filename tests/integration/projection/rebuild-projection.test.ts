import { config } from "dotenv";
import { asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { auditEvents, outboxEvents, pointBalanceProjection, pointLedgerEntries } from "@/db/schema";
import { confirmFact } from "@/modules/facts/confirm-fact.service";
import { submitErrorCount } from "@/modules/facts/submit-error-count.service";
import { createFormalPlan } from "@/modules/schedule/plan.service";
import { maintainHorizon } from "@/modules/schedule/maintain-horizon.service";
import { scheduleItems } from "@/db/schema";
import { rebuildProjection } from "@/modules/projection/rebuild-projection.service";
import { closeTestDb, getTestDb, migrateTestDb, resetIdentityTables } from "../../helpers/db";
import {
  bootstrapParentStudentRelationship,
  DEFAULT_PLAN_BODY,
  enableErrorCountPointRule,
  resetScheduleTables,
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
      scheduleItemId: item!.id,
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
});
