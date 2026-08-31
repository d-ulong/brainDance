import { config } from "dotenv";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  auditEvents,
  outboxEvents,
  pointBalanceProjection,
  pointLedgerEntries,
  pointRedemptions,
  redemptionCatalogItems,
  relationships,
} from "@/db/schema";
import { endRelationship } from "@/modules/family-access/end-relationship.service";
import {
  acceptParentForStudent,
  bootstrapVerifiedParentWithInvite,
} from "../../helpers/family-access";
import { closeTestDb, getTestDb, migrateTestDb, resetIdentityTables } from "../../helpers/db";
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
import { updateCatalogItem } from "@/modules/redemption/catalog.service";

config({ path: ".env.local" });
config({ path: ".env" });

const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);

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
    const { parentId, studentId, catalogItemId } = await bootstrapRedemptionFixture(db);
    await seedStudentBalance(db, studentId, 100);

    const created = await createRedemptionRequest(db, {
      studentId,
      actorId: studentId,
      catalogItemId,
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
});
