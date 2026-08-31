import { config } from "dotenv";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import {
  auditEvents,
  outboxEvents,
  pointBalanceProjection,
  pointLedgerEntries,
  pointRedemptions,
  redemptionCatalogItems,
  relationships,
} from "@/db/schema";
import { requireDatabaseUrl } from "@/lib/env";
import * as auditModule from "@/modules/audit/append-audit-event";
import * as outboxModule from "@/modules/outbox/append-outbox-event";
import { endRelationship } from "@/modules/family-access/end-relationship.service";
import {
  acceptParentForStudent,
  bootstrapVerifiedParentWithInvite,
  seedStudentUser,
} from "../../helpers/family-access";
import {
  closeTestDb,
  getTestDb,
  migrateTestDb,
  resetIdentityTables,
  type TestDb,
} from "../../helpers/db";
import {
  bootstrapCatalogItem,
  bootstrapRedemptionFixture,
  resetRedemptionTables,
  seedStudentBalance,
} from "../../helpers/redemption";
import {
  bootstrapParentStudentRelationship,
  FIXED_NOW,
  resetScheduleTables,
} from "../../helpers/schedule";
import {
  approveRedemptionRequest,
  cancelRedemptionRequest,
  createRedemptionRequest,
  rejectRedemptionRequest,
} from "@/modules/redemption/redemption.service";
import { createCatalogItem, updateCatalogItem } from "@/modules/redemption/catalog.service";
import { toFamilyMonth } from "@/modules/redemption/to-family-month";

config({ path: ".env.local" });
config({ path: ".env" });

const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);

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
  };
}

async function withIndependentConnection<T>(fn: (db: TestDb) => Promise<T>): Promise<T> {
  const client = postgres(requireDatabaseUrl(), { max: 1 });
  const independentDb = drizzle(client, { schema });
  try {
    return await fn(independentDb);
  } finally {
    await client.end({ timeout: 5 });
  }
}

describe.skipIf(!hasDb)("redemption lifecycle", () => {
  const db = getTestDb();

  beforeAll(async () => {
    await migrateTestDb();
  });

  beforeEach(async () => {
    await resetIdentityTables(db);
    await resetScheduleTables(db);
    await resetRedemptionTables(db);
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("preserves cost snapshot when catalog price changes", async () => {
    const { parentId, studentId, catalogItemId } = await bootstrapRedemptionFixture(db);

    const created = await createRedemptionRequest(db, {
      studentId,
      actorId: studentId,
      catalogItemId,
      idempotencyKey: "req-1",
      now: FIXED_NOW,
    });
    expect(created.redemption.costSnapshot).toBe(10);

    await updateCatalogItem(db, {
      parentId,
      studentId,
      itemId: catalogItemId,
      idempotencyKey: "update-cost",
      body: { cost: 25 },
      now: FIXED_NOW,
    });

    const [row] = await db
      .select()
      .from(pointRedemptions)
      .where(eq(pointRedemptions.id, created.redemption.id));
    expect(row?.costSnapshot).toBe(10);
  });

  it("enforces monthly limit", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);
    const { item } = await bootstrapCatalogItem(db, {
      parentId,
      studentId,
      monthlyLimit: 1,
    });

    await createRedemptionRequest(db, {
      studentId,
      actorId: studentId,
      catalogItemId: item.id,
      idempotencyKey: "req-1",
      now: FIXED_NOW,
    });

    await expect(
      createRedemptionRequest(db, {
        studentId,
        actorId: studentId,
        catalogItemId: item.id,
        idempotencyKey: "req-2",
        now: FIXED_NOW,
      }),
    ).rejects.toMatchObject({ code: "MONTHLY_LIMIT_EXCEEDED" });
  });

  it("rejects approval when balance insufficient or negative", async () => {
    const { parentId, studentId, catalogItemId } = await bootstrapRedemptionFixture(db);

    const lowBalance = await createRedemptionRequest(db, {
      studentId,
      actorId: studentId,
      catalogItemId,
      idempotencyKey: "req-low",
      now: FIXED_NOW,
    });

    await seedStudentBalance(db, studentId, 5);
    await expect(
      approveRedemptionRequest(db, {
        parentId,
        studentId,
        redemptionId: lowBalance.redemption.id,
        idempotencyKey: "approve-low",
        now: FIXED_NOW,
      }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });

    await seedStudentBalance(db, studentId, -1);
    const exact = await createRedemptionRequest(db, {
      studentId,
      actorId: studentId,
      catalogItemId,
      idempotencyKey: "req-exact",
      now: FIXED_NOW,
    });

    await expect(
      approveRedemptionRequest(db, {
        parentId,
        studentId,
        redemptionId: exact.redemption.id,
        idempotencyKey: "approve-neg",
        now: FIXED_NOW,
      }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });
  });

  it("approves with exact balance and writes single ledger, audit, outbox", async () => {
    const { parentId, studentId, catalogItemId } = await bootstrapRedemptionFixture(db);
    await seedStudentBalance(db, studentId, 10);

    const created = await createRedemptionRequest(db, {
      studentId,
      actorId: studentId,
      catalogItemId,
      idempotencyKey: "req-exact-balance",
      now: FIXED_NOW,
    });

    const approved = await approveRedemptionRequest(db, {
      parentId,
      studentId,
      redemptionId: created.redemption.id,
      idempotencyKey: "approve-exact",
      now: FIXED_NOW,
    });

    expect(approved.redemption.status).toBe("approved");
    expect(approved.redemption.ledgerEntryId).toBeTruthy();

    const ledgers = await db
      .select()
      .from(pointLedgerEntries)
      .where(eq(pointLedgerEntries.studentId, studentId));
    expect(ledgers).toHaveLength(1);
    expect(ledgers[0]?.amount).toBe(-10);
    expect(ledgers[0]?.sourceType).toBe("redemption");

    const [balance] = await db
      .select()
      .from(pointBalanceProjection)
      .where(eq(pointBalanceProjection.studentId, studentId));
    expect(balance?.balance).toBe(0);

    const audits = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.resourceId, created.redemption.id));
    expect(audits.some((a) => a.action === "point_redemption.approved")).toBe(true);

    const outbox = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.aggregateId, created.redemption.id));
    expect(outbox.some((o) => o.eventType === "point_redemption.approved")).toBe(true);
  });

  it("replays same idempotency key and conflicts on different payload", async () => {
    const fixture = await bootstrapRedemptionFixture(db);
    const { studentId, catalogItemId, parentId } = fixture;

    const first = await createRedemptionRequest(db, {
      studentId,
      actorId: studentId,
      catalogItemId,
      idempotencyKey: "same-key",
      now: FIXED_NOW,
    });

    const replay = await createRedemptionRequest(db, {
      studentId,
      actorId: studentId,
      catalogItemId,
      idempotencyKey: "same-key",
      now: FIXED_NOW,
    });
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.redemption.id).toBe(first.redemption.id);

    const { item: otherItem } = await bootstrapCatalogItem(db, {
      parentId,
      studentId,
      title: "Other",
      idempotencyKey: "other-catalog",
    });

    await expect(
      createRedemptionRequest(db, {
        studentId,
        actorId: studentId,
        catalogItemId: otherItem.id,
        idempotencyKey: "same-key",
        now: FIXED_NOW,
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("concurrent approve yields one terminal state and one deduction", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);
    await seedStudentBalance(db, studentId, 100);
    const { item } = await bootstrapCatalogItem(db, {
      parentId,
      studentId,
      monthlyLimit: 1,
    });

    const created = await createRedemptionRequest(db, {
      studentId,
      actorId: studentId,
      catalogItemId: item.id,
      idempotencyKey: "req-concurrent",
      now: FIXED_NOW,
    });

    const results = await Promise.allSettled([
      approveRedemptionRequest(db, {
        parentId,
        studentId,
        redemptionId: created.redemption.id,
        idempotencyKey: "approve-a",
        now: FIXED_NOW,
      }),
      approveRedemptionRequest(db, {
        parentId,
        studentId,
        redemptionId: created.redemption.id,
        idempotencyKey: "approve-b",
        now: FIXED_NOW,
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);

    const [row] = await db
      .select()
      .from(pointRedemptions)
      .where(eq(pointRedemptions.id, created.redemption.id));
    expect(row?.status).toBe("approved");

    const ledgers = await db
      .select()
      .from(pointLedgerEntries)
      .where(eq(pointLedgerEntries.studentId, studentId));
    expect(ledgers).toHaveLength(1);
  });

  it("AC-M6-01: concurrent create at monthly limit allows only one new request", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);
    const { item } = await bootstrapCatalogItem(db, {
      parentId,
      studentId,
      monthlyLimit: 1,
    });

    await createRedemptionRequest(db, {
      studentId,
      actorId: studentId,
      catalogItemId: item.id,
      idempotencyKey: "req-at-limit",
      now: FIXED_NOW,
    });

    await expect(
      createRedemptionRequest(db, {
        studentId,
        actorId: studentId,
        catalogItemId: item.id,
        idempotencyKey: "req-over-limit",
        now: FIXED_NOW,
      }),
    ).rejects.toMatchObject({ code: "MONTHLY_LIMIT_EXCEEDED" });
  });

  it("concurrent approve and reject yields one terminal state", async () => {
    const { parentId, studentId, catalogItemId } = await bootstrapRedemptionFixture(db);
    await seedStudentBalance(db, studentId, 100);

    const created = await createRedemptionRequest(db, {
      studentId,
      actorId: studentId,
      catalogItemId,
      idempotencyKey: "req-race",
      now: FIXED_NOW,
    });

    const results = await Promise.allSettled([
      approveRedemptionRequest(db, {
        parentId,
        studentId,
        redemptionId: created.redemption.id,
        idempotencyKey: "approve-race",
        now: FIXED_NOW,
      }),
      rejectRedemptionRequest(db, {
        parentId,
        studentId,
        redemptionId: created.redemption.id,
        reason: "No",
        idempotencyKey: "reject-race",
        now: FIXED_NOW,
      }),
    ]);

    expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);

    const [row] = await db
      .select()
      .from(pointRedemptions)
      .where(eq(pointRedemptions.id, created.redemption.id));
    expect(["approved", "rejected"]).toContain(row?.status);

    const ledgers = await db
      .select()
      .from(pointLedgerEntries)
      .where(eq(pointLedgerEntries.studentId, studentId));
    expect(ledgers.length).toBeLessThanOrEqual(1);
  });

  it("student can cancel pending; approve after cancel fails", async () => {
    const { parentId, studentId, catalogItemId } = await bootstrapRedemptionFixture(db);

    const created = await createRedemptionRequest(db, {
      studentId,
      actorId: studentId,
      catalogItemId,
      idempotencyKey: "req-cancel",
      now: FIXED_NOW,
    });

    const cancelled = await cancelRedemptionRequest(db, {
      studentId,
      actorId: studentId,
      redemptionId: created.redemption.id,
      idempotencyKey: "cancel-1",
      now: FIXED_NOW,
    });
    expect(cancelled.redemption.status).toBe("cancelled");

    await expect(
      approveRedemptionRequest(db, {
        parentId,
        studentId,
        redemptionId: created.redemption.id,
        idempotencyKey: "approve-after-cancel",
        now: FIXED_NOW,
      }),
    ).rejects.toMatchObject({ code: "STATE_CONFLICT" });
  });

  it("deactivates creator catalog and cancels pending on relationship end", async () => {
    const { parentId, studentId, catalogItemId } = await bootstrapRedemptionFixture(db);

    await createRedemptionRequest(db, {
      studentId,
      actorId: studentId,
      catalogItemId,
      idempotencyKey: "req-rel-end",
      now: FIXED_NOW,
    });

    const [rel] = await db
      .select()
      .from(relationships)
      .where(and(eq(relationships.parentId, parentId), eq(relationships.studentId, studentId)));

    await endRelationship(db, {
      actorId: parentId,
      relationshipId: rel!.id,
      idempotencyKey: "end-rel",
    });

    const [catalog] = await db
      .select()
      .from(redemptionCatalogItems)
      .where(eq(redemptionCatalogItems.id, catalogItemId));
    expect(catalog?.active).toBe(false);

    const redemptions = await db
      .select()
      .from(pointRedemptions)
      .where(eq(pointRedemptions.studentId, studentId));
    expect(redemptions.every((r) => r.status === "cancelled")).toBe(true);
  });

  it("non-creator parent cannot edit catalog", async () => {
    const { studentId, catalogItemId } = await bootstrapRedemptionFixture(db);
    const suffix = crypto.randomUUID().slice(0, 8);
    const { parentId: otherParentId } = await bootstrapVerifiedParentWithInvite(
      db,
      `other_${suffix}@test.local`,
    );
    await acceptParentForStudent(db, {
      parentId: otherParentId,
      studentId,
      idempotencySuffix: suffix,
    });

    await expect(
      updateCatalogItem(db, {
        parentId: otherParentId,
        studentId,
        itemId: catalogItemId,
        idempotencyKey: "other-update",
        body: { title: "Hacked" },
        now: FIXED_NOW,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("AC-M6-01: Asia/Shanghai requestMonth boundary at month rollover", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);
    const { item } = await bootstrapCatalogItem(db, { parentId, studentId });

    const endOfMonth = new Date("2026-01-31T15:59:59.000Z");
    const startOfNextMonth = new Date("2026-01-31T16:00:00.000Z");

    const jan = await createRedemptionRequest(db, {
      studentId,
      actorId: studentId,
      catalogItemId: item.id,
      idempotencyKey: "req-jan-boundary",
      now: endOfMonth,
    });
    const feb = await createRedemptionRequest(db, {
      studentId,
      actorId: studentId,
      catalogItemId: item.id,
      idempotencyKey: "req-feb-boundary",
      now: startOfNextMonth,
    });

    expect(toFamilyMonth(endOfMonth)).toBe("2026-01");
    expect(toFamilyMonth(startOfNextMonth)).toBe("2026-02");
    expect(jan.redemption.requestMonth).toBe("2026-01");
    expect(feb.redemption.requestMonth).toBe("2026-02");
  });

  it("AC-M6-02: concurrent approve and cancel yields one terminal state", async () => {
    const { parentId, studentId, catalogItemId } = await bootstrapRedemptionFixture(db);
    await seedStudentBalance(db, studentId, 100);

    const created = await createRedemptionRequest(db, {
      studentId,
      actorId: studentId,
      catalogItemId,
      idempotencyKey: "req-approve-cancel",
      now: FIXED_NOW,
    });

    const barrier = createConcurrentBarrier(2);
    const results = await Promise.allSettled([
      withIndependentConnection(async (conn) => {
        await barrier.wait();
        return approveRedemptionRequest(conn, {
          parentId,
          studentId,
          redemptionId: created.redemption.id,
          idempotencyKey: "approve-cancel-race",
          now: FIXED_NOW,
        });
      }),
      withIndependentConnection(async (conn) => {
        await barrier.wait();
        return cancelRedemptionRequest(conn, {
          studentId,
          actorId: studentId,
          redemptionId: created.redemption.id,
          idempotencyKey: "cancel-race",
          now: FIXED_NOW,
        });
      }),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);

    const [row] = await db
      .select()
      .from(pointRedemptions)
      .where(eq(pointRedemptions.id, created.redemption.id));
    expect(["approved", "cancelled"]).toContain(row?.status);

    const ledgers = await db
      .select()
      .from(pointLedgerEntries)
      .where(eq(pointLedgerEntries.studentId, studentId));
    expect(ledgers.length).toBeLessThanOrEqual(1);
  });

  it("AC-M6-01: ending one parent relationship preserves other parent catalog access", async () => {
    const { parentId: parent1Id } = await bootstrapVerifiedParentWithInvite(
      db,
      `parent1-${crypto.randomUUID()}@test.local`,
    );
    const { parentId: parent2Id } = await bootstrapVerifiedParentWithInvite(
      db,
      `parent2-${crypto.randomUUID()}@test.local`,
    );
    const student = await seedStudentUser(db, {
      username: `student_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });

    const rel1 = await acceptParentForStudent(db, {
      parentId: parent1Id,
      studentId: student.studentId,
      idempotencySuffix: "p1",
    });
    await acceptParentForStudent(db, {
      parentId: parent2Id,
      studentId: student.studentId,
      idempotencySuffix: "p2",
    });

    const { item } = await bootstrapCatalogItem(db, {
      parentId: parent1Id,
      studentId: student.studentId,
      idempotencyKey: "parent1-catalog",
    });

    await endRelationship(db, {
      actorId: parent1Id,
      relationshipId: rel1.relationshipId,
      idempotencyKey: "end-parent1-catalog",
    });

    const [catalog] = await db
      .select()
      .from(redemptionCatalogItems)
      .where(eq(redemptionCatalogItems.id, item.id));
    expect(catalog?.active).toBe(false);

    const parent2Catalog = await bootstrapCatalogItem(db, {
      parentId: parent2Id,
      studentId: student.studentId,
      title: "Parent2 Reward",
      idempotencyKey: "parent2-catalog",
    });
    expect(parent2Catalog.item.active).toBe(true);
  });

  it("AC-M6-01: ending one student relationship preserves other student catalog", async () => {
    const { parentId } = await bootstrapVerifiedParentWithInvite(
      db,
      `parent-${crypto.randomUUID()}@test.local`,
    );
    const student1 = await seedStudentUser(db, {
      username: `student1_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });
    const student2 = await seedStudentUser(db, {
      username: `student2_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });

    const rel1 = await acceptParentForStudent(db, {
      parentId,
      studentId: student1.studentId,
      idempotencySuffix: "s1",
    });
    await acceptParentForStudent(db, {
      parentId,
      studentId: student2.studentId,
      idempotencySuffix: "s2",
    });

    const endedCatalog = await bootstrapCatalogItem(db, {
      parentId,
      studentId: student1.studentId,
      idempotencyKey: "ended-student-catalog",
    });
    const activeCatalog = await bootstrapCatalogItem(db, {
      parentId,
      studentId: student2.studentId,
      idempotencyKey: "active-student-catalog",
    });

    await endRelationship(db, {
      actorId: parentId,
      relationshipId: rel1.relationshipId,
      idempotencyKey: "end-student1-catalog",
    });

    const [endedRow] = await db
      .select()
      .from(redemptionCatalogItems)
      .where(eq(redemptionCatalogItems.id, endedCatalog.item.id));
    expect(endedRow?.active).toBe(false);

    const [activeRow] = await db
      .select()
      .from(redemptionCatalogItems)
      .where(eq(redemptionCatalogItems.id, activeCatalog.item.id));
    expect(activeRow?.active).toBe(true);
  });

  it("P1-F01: rolls back catalog create when audit append fails", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);
    const spy = vi
      .spyOn(auditModule, "appendAuditEvent")
      .mockRejectedValueOnce(new Error("audit failure"));

    await expect(
      createCatalogItem(db, {
        parentId,
        studentId,
        idempotencyKey: "create-audit-fail",
        body: { title: "Rollback Test", cost: 5 },
        now: FIXED_NOW,
      }),
    ).rejects.toThrow("audit failure");

    const rows = await db
      .select()
      .from(redemptionCatalogItems)
      .where(eq(redemptionCatalogItems.studentId, studentId));
    expect(rows).toHaveLength(0);

    spy.mockRestore();
  });

  it("P1-F01: rolls back catalog update when outbox append fails", async () => {
    const { parentId, studentId, catalogItemId } = await bootstrapRedemptionFixture(db);
    const spy = vi
      .spyOn(outboxModule, "appendOutboxEvent")
      .mockRejectedValueOnce(new Error("outbox failure"));

    await expect(
      updateCatalogItem(db, {
        parentId,
        studentId,
        itemId: catalogItemId,
        idempotencyKey: "update-outbox-fail",
        body: { title: "Should Roll Back" },
        now: FIXED_NOW,
      }),
    ).rejects.toThrow("outbox failure");

    const [row] = await db
      .select()
      .from(redemptionCatalogItems)
      .where(eq(redemptionCatalogItems.id, catalogItemId));
    expect(row?.title).toBe("Test Reward");

    const audits = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.idempotencyKey, "audit:redemption-catalog-updated:update-outbox-fail"));
    expect(audits).toHaveLength(0);

    spy.mockRestore();
  });

  it("P1-F04: catalog update replays same payload and conflicts on different payload", async () => {
    const { parentId, studentId, catalogItemId } = await bootstrapRedemptionFixture(db);

    const first = await updateCatalogItem(db, {
      parentId,
      studentId,
      itemId: catalogItemId,
      idempotencyKey: "update-idem",
      body: { title: "Updated Once" },
      now: FIXED_NOW,
    });
    expect(first.idempotentReplay).toBe(false);

    const replay = await updateCatalogItem(db, {
      parentId,
      studentId,
      itemId: catalogItemId,
      idempotencyKey: "update-idem",
      body: { title: "Updated Once" },
      now: FIXED_NOW,
    });
    expect(replay.idempotentReplay).toBe(true);

    await expect(
      updateCatalogItem(db, {
        parentId,
        studentId,
        itemId: catalogItemId,
        idempotencyKey: "update-idem",
        body: { title: "Different Title" },
        now: FIXED_NOW,
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    const audits = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.idempotencyKey, "audit:redemption-catalog-updated:update-idem"));
    expect(audits).toHaveLength(1);
  });

  it("P1-F04: reject replays same payload and conflicts on different reason", async () => {
    const { parentId, studentId, catalogItemId } = await bootstrapRedemptionFixture(db);
    const created = await createRedemptionRequest(db, {
      studentId,
      actorId: studentId,
      catalogItemId,
      idempotencyKey: "req-reject-idem",
      now: FIXED_NOW,
    });

    const first = await rejectRedemptionRequest(db, {
      parentId,
      studentId,
      redemptionId: created.redemption.id,
      reason: "Not today",
      idempotencyKey: "reject-idem",
      now: FIXED_NOW,
    });
    expect(first.idempotentReplay).toBe(false);

    const replay = await rejectRedemptionRequest(db, {
      parentId,
      studentId,
      redemptionId: created.redemption.id,
      reason: "Not today",
      idempotencyKey: "reject-idem",
      now: FIXED_NOW,
    });
    expect(replay.idempotentReplay).toBe(true);

    await expect(
      rejectRedemptionRequest(db, {
        parentId,
        studentId,
        redemptionId: created.redemption.id,
        reason: "Different reason",
        idempotencyKey: "reject-idem",
        now: FIXED_NOW,
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    const audits = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.idempotencyKey, "audit:redemption-rejected:reject-idem"));
    expect(audits).toHaveLength(1);
  });
});
