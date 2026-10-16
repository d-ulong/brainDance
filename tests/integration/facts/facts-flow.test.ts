import { config } from "dotenv";
import { asc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import * as schema from "@/db/schema";
import {
  auditEvents,
  deletionRequests,
  factVersions,
  pointBalanceProjection,
  pointLedgerEntries,
  scheduleItems,
  settlements,
  relationships,
  users,
} from "@/db/schema";
import { confirmFact } from "@/modules/facts/confirm-fact.service";
import { correctFact } from "@/modules/facts/correct-fact.service";
import { submitErrorCount } from "@/modules/facts/submit-error-count.service";
import { endRelationship } from "@/modules/family-access/end-relationship.service";
import { createFormalPlan } from "@/modules/schedule/plan.service";
import { maintainHorizon } from "@/modules/schedule/maintain-horizon.service";
import { addFamilyDays } from "@/modules/time-policy/add-family-days";
import { familyLocalInstant } from "@/modules/time-policy/family-local-instant";
import { requireDatabaseUrl } from "@/lib/env";
import {
  bootstrapParentStudentRelationship,
  DEFAULT_PLAN_BODY,
  enableErrorCountPointRule,
  resetScheduleTables,
} from "../../helpers/schedule";
import {
  closeTestDb,
  createIndependentTestDb,
  getTestDb,
  migrateTestDb,
  resetIdentityTables,
  type TestDb,
} from "../../helpers/db";
import { bootstrapAdmin } from "../../helpers/identity";

config({ path: ".env.local" });
config({ path: ".env" });

const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);
const WITHIN_WINDOW_NOW = new Date("2026-01-05T04:00:00.000Z");
const PAST_WINDOW_NOW = new Date("2026-01-20T04:00:00.000Z");

function correctionNowForFamilyDate(familyDate: string): Date {
  return familyLocalInstant(addFamilyDays(familyDate, 2), "12:00:00.000");
}

function createConcurrentBarrier(participants: number) {
  let arrived = 0;
  let release!: () => void;
  const proceed = new Promise<void>((resolve) => {
    release = resolve;
  });

  return {
    async wait(): Promise<void> {
      arrived += 1;
      if (arrived === participants) {
        release();
      }
      await proceed;
    },
    release(): void {
      release();
    },
  };
}

async function withIndependentTransaction<T>(
  fn: (tx: Parameters<Parameters<TestDb["transaction"]>[0]>[0]) => Promise<T>,
): Promise<T> {
  const client = postgres(requireDatabaseUrl(), { max: 1 });
  const independentDb = drizzle(client, { schema });
  try {
    return await independentDb.transaction(fn);
  } finally {
    await client.end({ timeout: 5 });
  }
}

async function seedFormalItem(db: TestDb) {
  const linked = await bootstrapParentStudentRelationship(db);
  await enableErrorCountPointRule(db, linked);

  await createFormalPlan(db, {
    ownerId: linked.parentId,
    studentId: linked.studentId,
    idempotencyKey: `plan-${linked.suffix}`,
    body: DEFAULT_PLAN_BODY,
    now: WITHIN_WINDOW_NOW,
  });

  await maintainHorizon(db, {
    actorId: linked.parentId,
    studentId: linked.studentId,
    idempotencyKey: `horizon-${linked.suffix}`,
    now: WITHIN_WINDOW_NOW,
  });

  const [item] = await db
    .select()
    .from(scheduleItems)
    .where(eq(scheduleItems.studentId, linked.studentId))
    .orderBy(asc(scheduleItems.familyDate))
    .limit(1);

  if (!item) {
    throw new Error("Schedule item missing");
  }

  return { ...linked, itemId: item!.id, familyDate: item!.familyDate };
}

describe.skipIf(!hasDb)("m3 facts flow", () => {
  const db = getTestDb();

  beforeAll(async () => {
    await migrateTestDb();
  });

  beforeEach(async () => {
    await resetIdentityTables(db);
    await resetScheduleTables(db);
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("P2-01 confirms before settlement and skips unconfirmed facts", async () => {
    const ctx = await seedFormalItem(db);

    const submitted = await submitErrorCount(db, {
      actorId: ctx.studentId,
      scheduleItemId: ctx.itemId,
      idempotencyKey: "submit-1",
      body: { errorCount: 2 },
      now: WITHIN_WINDOW_NOW,
    });

    const unconfirmedSettlements = await db
      .select()
      .from(settlements)
      .where(eq(settlements.factVersionId, submitted.factVersionId));
    expect(unconfirmedSettlements).toHaveLength(0);

    const confirmed = await confirmFact(db, {
      parentId: ctx.parentId,
      factId: submitted.factVersionId,
      idempotencyKey: "confirm-1",
      now: WITHIN_WINDOW_NOW,
    });

    expect(confirmed.settlementId).toBeTruthy();
    expect(confirmed.ledgerEntryId).toBeTruthy();

    const balance = await db
      .select()
      .from(pointBalanceProjection)
      .where(eq(pointBalanceProjection.studentId, ctx.studentId));
    expect(balance[0]?.balance).toBe(10);
  });

  it("RS-R01 preserves reversal settlement period and result semantics", async () => {
    const ctx = await seedFormalItem(db);
    const correctionNow = correctionNowForFamilyDate(ctx.familyDate);

    const submitted = await submitErrorCount(db, {
      actorId: ctx.studentId,
      scheduleItemId: ctx.itemId,
      idempotencyKey: "submit-rs-r01",
      body: { errorCount: 1 },
      now: correctionNow,
    });

    const confirmed = await confirmFact(db, {
      parentId: ctx.parentId,
      factId: submitted.factVersionId,
      idempotencyKey: "confirm-rs-r01",
      now: correctionNow,
    });

    const predecessorRewardSettlements = await db
      .select()
      .from(settlements)
      .where(eq(settlements.factVersionId, submitted.factVersionId));
    expect(predecessorRewardSettlements).toHaveLength(1);
    expect(predecessorRewardSettlements[0]?.result).toBe("reward");
    expect(predecessorRewardSettlements[0]?.settlementPeriod).toBe(ctx.familyDate);

    const corrected = await correctFact(db, {
      actorId: ctx.parentId,
      factId: submitted.factVersionId,
      idempotencyKey: "correct-rs-r01",
      body: { errorCount: 4, reason: "miscounted" },
      now: correctionNow,
    });

    const predecessorSettlementsAfter = await db
      .select()
      .from(settlements)
      .where(eq(settlements.factVersionId, submitted.factVersionId));
    expect(predecessorSettlementsAfter).toHaveLength(2);
    expect(predecessorSettlementsAfter.find((row) => row.result === "reward")?.id).toBe(
      confirmed.settlementId,
    );

    const reversalSettlement = predecessorSettlementsAfter.find((row) => row.result === "reversal");
    expect(reversalSettlement?.settlementPeriod).toBe(ctx.familyDate);

    const predecessorLedger = await db
      .select()
      .from(pointLedgerEntries)
      .where(eq(pointLedgerEntries.settlementId, confirmed.settlementId))
      .limit(1);
    expect(predecessorLedger[0]?.amount).toBe(10);

    const reversals = await db
      .select()
      .from(pointLedgerEntries)
      .where(sql`${pointLedgerEntries.reversesEntryId} IS NOT NULL`);
    expect(reversals).toHaveLength(1);
    expect(reversals[0]?.amount).toBe(-10);
    expect(reversals[0]?.reversesEntryId).toBe(predecessorLedger[0]?.id);
    expect(reversals[0]?.settlementId).toBe(reversalSettlement?.id);

    const successorSettlements = await db
      .select()
      .from(settlements)
      .where(eq(settlements.factVersionId, corrected.successorFactId));
    expect(successorSettlements).toHaveLength(1);
    expect(successorSettlements[0]?.result).toBe("reward");
    expect(successorSettlements[0]?.settlementPeriod).toBe(ctx.familyDate);
  });

  it("P2-02 correction keeps predecessor immutable and creates exactly one reversal", async () => {
    const ctx = await seedFormalItem(db);
    const correctionNow = correctionNowForFamilyDate(ctx.familyDate);

    const submitted = await submitErrorCount(db, {
      actorId: ctx.studentId,
      scheduleItemId: ctx.itemId,
      idempotencyKey: "submit-correct",
      body: { errorCount: 1 },
      now: correctionNow,
    });

    await confirmFact(db, {
      parentId: ctx.parentId,
      factId: submitted.factVersionId,
      idempotencyKey: "confirm-correct",
      now: correctionNow,
    });

    const predecessorBefore = await db
      .select()
      .from(factVersions)
      .where(eq(factVersions.id, submitted.factVersionId))
      .limit(1);

    const corrected = await correctFact(db, {
      actorId: ctx.parentId,
      factId: submitted.factVersionId,
      idempotencyKey: "correct-1",
      body: { errorCount: 4, reason: "miscounted" },
      now: correctionNow,
    });

    expect(corrected.reversalLedgerEntryIds).toHaveLength(1);

    const predecessor = await db
      .select()
      .from(factVersions)
      .where(eq(factVersions.id, submitted.factVersionId))
      .limit(1);

    expect(predecessor[0]).toEqual(predecessorBefore[0]);
    expect(predecessor[0]?.voidedAt).toBeNull();
    expect(predecessor[0]?.supersedesFactVersionId).toBeNull();

    const successor = await db
      .select()
      .from(factVersions)
      .where(eq(factVersions.id, corrected.successorFactId))
      .limit(1);
    expect(successor[0]?.supersedesFactVersionId).toBe(submitted.factVersionId);

    const reversals = await db
      .select()
      .from(pointLedgerEntries)
      .where(sql`${pointLedgerEntries.reversesEntryId} IS NOT NULL`);
    expect(reversals).toHaveLength(1);
    expect(reversals[0]?.amount).toBe(-10);

    const successorSettlements = await db
      .select()
      .from(settlements)
      .where(eq(settlements.factVersionId, corrected.successorFactId));
    expect(successorSettlements).toHaveLength(1);

    const auditRows = await db.select().from(auditEvents);
    expect(auditRows.some((row) => row.action === "fact.corrected")).toBe(true);
  });

  it("P2-03 replays confirm and correct commands idempotently", async () => {
    const ctx = await seedFormalItem(db);
    const correctionNow = correctionNowForFamilyDate(ctx.familyDate);

    const submitted = await submitErrorCount(db, {
      actorId: ctx.studentId,
      scheduleItemId: ctx.itemId,
      idempotencyKey: "submit-replay",
      body: { errorCount: 0 },
      now: correctionNow,
    });

    const confirm1 = await confirmFact(db, {
      parentId: ctx.parentId,
      factId: submitted.factVersionId,
      idempotencyKey: "confirm-replay",
      now: correctionNow,
    });

    const confirm2 = await confirmFact(db, {
      parentId: ctx.parentId,
      factId: submitted.factVersionId,
      idempotencyKey: "confirm-replay",
      now: correctionNow,
    });

    expect(confirm2.idempotentReplay).toBe(true);
    expect(confirm2.settlementId).toBe(confirm1.settlementId);

    const correct1 = await correctFact(db, {
      actorId: ctx.parentId,
      factId: submitted.factVersionId,
      idempotencyKey: "correct-replay",
      body: { errorCount: 2, reason: "fix count" },
      now: correctionNow,
    });

    const correct2 = await correctFact(db, {
      actorId: ctx.parentId,
      factId: submitted.factVersionId,
      idempotencyKey: "correct-replay",
      body: { errorCount: 2, reason: "fix count" },
      now: correctionNow,
    });

    expect(correct2.idempotentReplay).toBe(true);
    expect(correct2.successorFactId).toBe(correct1.successorFactId);
  });

  it("P2-04 rejects correction outside window for parents", async () => {
    const ctx = await seedFormalItem(db);

    const submitted = await submitErrorCount(db, {
      actorId: ctx.studentId,
      scheduleItemId: ctx.itemId,
      idempotencyKey: "submit-window",
      body: { errorCount: 1 },
      now: WITHIN_WINDOW_NOW,
    });

    await confirmFact(db, {
      parentId: ctx.parentId,
      factId: submitted.factVersionId,
      idempotencyKey: "confirm-window",
      now: WITHIN_WINDOW_NOW,
    });

    await expect(
      correctFact(db, {
        actorId: ctx.parentId,
        factId: submitted.factVersionId,
        idempotencyKey: "correct-window",
        body: { errorCount: 0, reason: "too late" },
        now: PAST_WINDOW_NOW,
      }),
    ).rejects.toMatchObject({ code: "WINDOW_EXPIRED" });
  });

  it("P2-05 concurrent confirm commands leave one settlement", async () => {
    const ctx = await seedFormalItem(db);

    const submitted = await submitErrorCount(db, {
      actorId: ctx.studentId,
      scheduleItemId: ctx.itemId,
      idempotencyKey: "submit-concurrent",
      body: { errorCount: 1 },
      now: WITHIN_WINDOW_NOW,
    });

    const barrier = createConcurrentBarrier(2);

    const results = await Promise.allSettled([
      withIndependentTransaction(async () => {
        await barrier.wait();
        return confirmFact(db, {
          parentId: ctx.parentId,
          factId: submitted.factVersionId,
          idempotencyKey: "confirm-concurrent",
          now: WITHIN_WINDOW_NOW,
        });
      }),
      withIndependentTransaction(async () => {
        await barrier.wait();
        return confirmFact(db, {
          parentId: ctx.parentId,
          factId: submitted.factVersionId,
          idempotencyKey: "confirm-concurrent",
          now: WITHIN_WINDOW_NOW,
        });
      }),
    ]);

    barrier.release();

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled.length).toBeGreaterThan(0);

    const factSettlements = await db
      .select()
      .from(settlements)
      .where(eq(settlements.factVersionId, submitted.factVersionId));
    expect(factSettlements).toHaveLength(1);

    const ledgerCount = await db.select().from(pointLedgerEntries);
    expect(ledgerCount.filter((e) => e.amount > 0)).toHaveLength(1);
  });

  it("P2-06 concurrent correction with same key leaves one successor chain", async () => {
    const ctx = await seedFormalItem(db);
    const correctionNow = correctionNowForFamilyDate(ctx.familyDate);

    const submitted = await submitErrorCount(db, {
      actorId: ctx.studentId,
      scheduleItemId: ctx.itemId,
      idempotencyKey: "submit-correct-concurrent",
      body: { errorCount: 1 },
      now: correctionNow,
    });

    await confirmFact(db, {
      parentId: ctx.parentId,
      factId: submitted.factVersionId,
      idempotencyKey: "confirm-correct-concurrent",
      now: correctionNow,
    });

    const barrier = createConcurrentBarrier(2);

    const results = await Promise.allSettled([
      withIndependentTransaction(async () => {
        await barrier.wait();
        return correctFact(db, {
          actorId: ctx.parentId,
          factId: submitted.factVersionId,
          idempotencyKey: "correct-concurrent",
          body: { errorCount: 3, reason: "race" },
          now: correctionNow,
        });
      }),
      withIndependentTransaction(async () => {
        await barrier.wait();
        return correctFact(db, {
          actorId: ctx.parentId,
          factId: submitted.factVersionId,
          idempotencyKey: "correct-concurrent",
          body: { errorCount: 3, reason: "race" },
          now: correctionNow,
        });
      }),
    ]);

    barrier.release();

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled.length).toBeGreaterThan(0);

    const successors = await db
      .select()
      .from(factVersions)
      .where(eq(factVersions.supersedesFactVersionId, submitted.factVersionId));
    expect(successors).toHaveLength(1);

    const factSettlements = await db.select().from(settlements);
    expect(factSettlements.filter((s) => s.factVersionId === successors[0]!.id)).toHaveLength(1);

    const predecessorSettlements = factSettlements.filter(
      (s) => s.factVersionId === submitted.factVersionId,
    );
    expect(predecessorSettlements.filter((s) => s.result === "reward")).toHaveLength(1);
    expect(predecessorSettlements.filter((s) => s.result === "reversal")).toHaveLength(1);

    const reversals = await db
      .select()
      .from(pointLedgerEntries)
      .where(sql`${pointLedgerEntries.reversesEntryId} IS NOT NULL`);
    expect(reversals).toHaveLength(1);

    const positiveLedger = await db
      .select()
      .from(pointLedgerEntries)
      .where(
        sql`${pointLedgerEntries.amount} > 0 AND ${pointLedgerEntries.reversesEntryId} IS NULL`,
      );
    expect(positiveLedger.length).toBeGreaterThanOrEqual(2);
  });

  it("P2-07 admin correction bypasses parent window and writes admin audit", async () => {
    const ctx = await seedFormalItem(db);

    const submitted = await submitErrorCount(db, {
      actorId: ctx.studentId,
      scheduleItemId: ctx.itemId,
      idempotencyKey: "submit-admin",
      body: { errorCount: 2 },
      now: PAST_WINDOW_NOW,
    });

    await confirmFact(db, {
      parentId: ctx.parentId,
      factId: submitted.factVersionId,
      idempotencyKey: "confirm-admin",
      now: PAST_WINDOW_NOW,
    });

    const { adminId } = await bootstrapAdmin(db, `admin_${ctx.suffix}@test.local`);

    const corrected = await correctFact(db, {
      actorId: adminId,
      factId: submitted.factVersionId,
      idempotencyKey: "admin-correct-service",
      body: { errorCount: 0, reason: "security fix" },
      adminOverride: { reason: "security" },
      now: PAST_WINDOW_NOW,
    });

    expect(corrected.successorFactId).toBeTruthy();

    const auditRows = await db.select().from(auditEvents);
    expect(auditRows.some((row) => row.action === "fact.corrected.admin")).toBe(true);
  });

  it.each(["frozen", "adult"] as const)(
    "blocks all fact commands and replays for a %s student, including admin override",
    async (restriction) => {
      const ctx = await seedFormalItem(db);
      const now = correctionNowForFamilyDate(ctx.familyDate);
      const pending = await submitErrorCount(db, {
        actorId: ctx.studentId,
        scheduleItemId: ctx.itemId,
        idempotencyKey: "guard-pending",
        body: { errorCount: 2 },
        now,
      });
      const confirmed = await submitErrorCount(db, {
        actorId: ctx.studentId,
        scheduleItemId: ctx.itemId,
        idempotencyKey: "guard-confirmed",
        body: { errorCount: 1 },
        now,
      });
      await confirmFact(db, {
        parentId: ctx.parentId,
        factId: confirmed.factVersionId,
        idempotencyKey: "guard-confirm",
        now,
      });
      await correctFact(db, {
        actorId: ctx.parentId,
        factId: confirmed.factVersionId,
        idempotencyKey: "guard-correct",
        body: { errorCount: 0, reason: "original correction" },
        now,
      });
      const { adminId } = await bootstrapAdmin(db);
      if (restriction === "frozen") {
        await db
          .insert(deletionRequests)
          .values({
            targetType: "student_account",
            targetId: ctx.studentId,
            studentId: ctx.studentId,
            requestedBy: ctx.studentId,
            status: "frozen",
            revocableUntil: new Date(now.getTime() + 30 * 86_400_000),
            createIdempotencyKey: "facts-freeze",
            createIdempotencyPayloadHash: "fixture",
            requestedAt: now,
            createdAt: now,
            updatedAt: now,
          });
      } else {
        await db.update(users).set({ birthDate: "2000-01-01" }).where(eq(users.id, ctx.studentId));
      }
      const expected = { code: restriction === "frozen" ? "FROZEN" : "FORBIDDEN" };
      const beforeFacts = await db.select().from(factVersions);
      const beforeLedger = await db.select().from(pointLedgerEntries);
      await expect(
        submitErrorCount(db, {
          actorId: ctx.studentId,
          scheduleItemId: ctx.itemId,
          idempotencyKey: "guard-new-submit",
          body: { errorCount: 3 },
          now,
        }),
      ).rejects.toMatchObject(expected);
      await expect(
        submitErrorCount(db, {
          actorId: ctx.studentId,
          scheduleItemId: ctx.itemId,
          idempotencyKey: "guard-pending",
          body: { errorCount: 2 },
          now,
        }),
      ).rejects.toMatchObject(expected);
      await expect(
        confirmFact(db, {
          parentId: ctx.parentId,
          factId: pending.factVersionId,
          idempotencyKey: "guard-new-confirm",
          now,
        }),
      ).rejects.toMatchObject(expected);
      await expect(
        confirmFact(db, {
          parentId: ctx.parentId,
          factId: confirmed.factVersionId,
          idempotencyKey: "guard-confirm",
          now,
        }),
      ).rejects.toMatchObject(expected);
      await expect(
        correctFact(db, {
          actorId: ctx.parentId,
          factId: confirmed.factVersionId,
          idempotencyKey: "guard-new-correct",
          body: { errorCount: 3, reason: "blocked correction" },
          now,
        }),
      ).rejects.toMatchObject(expected);
      await expect(
        correctFact(db, {
          actorId: ctx.parentId,
          factId: confirmed.factVersionId,
          idempotencyKey: "guard-correct",
          body: { errorCount: 0, reason: "original correction" },
          now,
        }),
      ).rejects.toMatchObject(expected);
      await expect(
        correctFact(db, {
          actorId: adminId,
          factId: confirmed.factVersionId,
          idempotencyKey: "guard-correct",
          body: { errorCount: 0, reason: "original correction" },
          adminOverride: { reason: "security" },
          now,
        }),
      ).rejects.toMatchObject(expected);
      expect(await db.select().from(factVersions)).toEqual(beforeFacts);
      expect(await db.select().from(pointLedgerEntries)).toEqual(beforeLedger);
    },
  );

  it.each(["confirm", "correct"] as const)(
    "rechecks relationship after a queued %s acquires the subject lock",
    async (command) => {
      const ctx = await seedFormalItem(db);
      const now = correctionNowForFamilyDate(ctx.familyDate);
      const submitted = await submitErrorCount(db, {
        actorId: ctx.studentId,
        scheduleItemId: ctx.itemId,
        idempotencyKey: "queue-submit",
        body: { errorCount: 2 },
        now,
      });
      if (command === "correct")
        await confirmFact(db, {
          parentId: ctx.parentId,
          factId: submitted.factVersionId,
          idempotencyKey: "queue-confirm",
          now,
        });
      const [relationship] = await db
        .select()
        .from(relationships)
        .where(eq(relationships.studentId, ctx.studentId))
        .limit(1);
      const independent = createIndependentTestDb();
      let pending: Promise<unknown> | undefined;
      const beforeFacts = await db.select().from(factVersions);
      const beforeLedger = await db.select().from(pointLedgerEntries);
      try {
        const pidRows = await independent.db.execute(sql`SELECT pg_backend_pid() AS pid`);
        const workerPid = (pidRows[0] as { pid: number }).pid;
        await db.transaction(async (tx) => {
          await tx.execute(sql`SELECT id FROM users WHERE id = ${ctx.studentId}::uuid FOR UPDATE`);
          pending = (
            command === "confirm"
              ? confirmFact(independent.db, {
                  parentId: ctx.parentId,
                  factId: submitted.factVersionId,
                  idempotencyKey: "queued-confirm",
                  now,
                })
              : correctFact(independent.db, {
                  actorId: ctx.parentId,
                  factId: submitted.factVersionId,
                  idempotencyKey: "queued-correct",
                  body: { errorCount: 0, reason: "queued correction" },
                  now,
                })
          ).then(
            () => null,
            (error: unknown) => error,
          );
          await expect
            .poll(
              async () => {
                const rows = await db.execute(
                  sql`SELECT cardinality(pg_blocking_pids(${workerPid}::int)) > 0 AS blocked`,
                );
                return (rows[0] as { blocked: boolean }).blocked;
              },
              { timeout: 5_000 },
            )
            .toBe(true);
          await endRelationship(tx, {
            actorId: ctx.parentId,
            relationshipId: relationship!.id,
            idempotencyKey: "queue-end-relationship",
          });
        });
        expect(await pending).toMatchObject({ code: "FORBIDDEN" });
        expect(await db.select().from(factVersions)).toEqual(beforeFacts);
        expect(await db.select().from(pointLedgerEntries)).toEqual(beforeLedger);
      } finally {
        await pending;
        await independent.close();
      }
    },
  );

  it("does not accept an admin override flag from a parent", async () => {
    const ctx = await seedFormalItem(db);
    const now = correctionNowForFamilyDate(ctx.familyDate);
    const submitted = await submitErrorCount(db, {
      actorId: ctx.studentId,
      scheduleItemId: ctx.itemId,
      idempotencyKey: "forged-submit",
      body: { errorCount: 2 },
      now,
    });
    await confirmFact(db, {
      parentId: ctx.parentId,
      factId: submitted.factVersionId,
      idempotencyKey: "forged-confirm",
      now,
    });
    await expect(
      correctFact(db, {
        actorId: ctx.parentId,
        factId: submitted.factVersionId,
        idempotencyKey: "forged-correct",
        body: { errorCount: 0, reason: "not an administrator" },
        adminOverride: { reason: "data_correction" },
        now,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
