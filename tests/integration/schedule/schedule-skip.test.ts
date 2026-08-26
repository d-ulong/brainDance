import { config } from "dotenv";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { factVersions, pointLedgerEntries, scheduleEvents, scheduleItems } from "@/db/schema";
import { createFormalPlan } from "@/modules/schedule/plan.service";
import { skipScheduleItem } from "@/modules/schedule/skip-schedule.service";
import { ScheduleError } from "@/modules/schedule/errors";
import {
  bootstrapParentStudentRelationship,
  DEFAULT_PLAN_BODY,
  FIXED_NOW,
  resetScheduleTables,
} from "../../helpers/schedule";
import { closeTestDb, getTestDb, migrateTestDb, resetIdentityTables } from "../../helpers/db";

config({ path: ".env.local" });
config({ path: ".env" });

const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("schedule skip", () => {
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

  async function seedTodayItem() {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);

    await createFormalPlan(db, {
      ownerId: parentId,
      studentId,
      idempotencyKey: "create-skip",
      body: { ...DEFAULT_PLAN_BODY, startDate: "2026-01-15" },
      now: FIXED_NOW,
    });

    const [item] = await db
      .select()
      .from(scheduleItems)
      .where(
        and(eq(scheduleItems.studentId, studentId), eq(scheduleItems.familyDate, "2026-01-15")),
      )
      .limit(1);

    return { parentId, studentId, itemId: item!.id };
  }

  it("skips pending item without fact or ledger (F17)", async () => {
    const { studentId, itemId } = await seedTodayItem();

    const result = await skipScheduleItem(db, {
      actorId: studentId,
      scheduleItemId: itemId,
      idempotencyKey: "skip-1",
      body: { reason: "Too tired" },
      now: FIXED_NOW,
    });

    expect(result.idempotentReplay).toBe(false);
    expect(result.reason).toBe("Too tired");

    const facts = await db
      .select()
      .from(factVersions)
      .where(eq(factVersions.scheduleItemId, itemId));
    expect(facts).toHaveLength(0);

    const ledger = await db.select().from(pointLedgerEntries);
    expect(ledger).toHaveLength(0);
  });

  it("parent with relationship can skip (F16 auth path)", async () => {
    const { parentId, itemId } = await seedTodayItem();

    await skipScheduleItem(db, {
      actorId: parentId,
      scheduleItemId: itemId,
      idempotencyKey: "skip-parent",
      now: FIXED_NOW,
    });

    const [item] = await db
      .select()
      .from(scheduleItems)
      .where(eq(scheduleItems.id, itemId))
      .limit(1);
    expect(item?.status).toBe("skipped");
  });

  it("replay does not overwrite skip reason (R3/F18)", async () => {
    const { studentId, itemId } = await seedTodayItem();

    await skipScheduleItem(db, {
      actorId: studentId,
      scheduleItemId: itemId,
      idempotencyKey: "skip-reason",
      body: { reason: "Original reason" },
      now: FIXED_NOW,
    });

    const replay = await skipScheduleItem(db, {
      actorId: studentId,
      scheduleItemId: itemId,
      idempotencyKey: "skip-reason",
      body: { reason: "Original reason" },
      now: FIXED_NOW,
    });

    expect(replay.idempotentReplay).toBe(true);
    expect(replay.reason).toBe("Original reason");

    const [event] = await db
      .select()
      .from(scheduleEvents)
      .where(eq(scheduleEvents.scheduleItemId, itemId))
      .limit(1);

    expect(event?.reason).toBe("Original reason");
  });

  it("rejects skip outside window with persist expired (F18/F7)", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);

    const created = await createFormalPlan(db, {
      ownerId: parentId,
      studentId,
      idempotencyKey: "create-skip-expired",
      body: { ...DEFAULT_PLAN_BODY, startDate: "2026-01-15" },
      now: FIXED_NOW,
    });

    await db.execute(`
      INSERT INTO schedule_items (
        plan_id, plan_version_id, student_id, owner_id, family_date, slot_key,
        scheduled_at, status, source, occurrence_key
      ) VALUES (
        '${created.planId}', '${created.versionId}', '${studentId}', '${parentId}',
        '2026-01-01', 'default', '2026-01-01T12:00:00Z', 'pending', 'plan', 'manual-expired-skip'
      )
    `);

    const [item] = await db
      .select()
      .from(scheduleItems)
      .where(eq(scheduleItems.occurrenceKey, "manual-expired-skip"))
      .limit(1);

    await expect(
      skipScheduleItem(db, {
        actorId: studentId,
        scheduleItemId: item!.id,
        idempotencyKey: "skip-expired",
        now: FIXED_NOW,
      }),
    ).rejects.toMatchObject({ code: "WINDOW_EXPIRED" satisfies ScheduleError["code"] });
  });

  it("rejects complete and skip same key conflict (F16)", async () => {
    const { studentId, itemId } = await seedTodayItem();

    await skipScheduleItem(db, {
      actorId: studentId,
      scheduleItemId: itemId,
      idempotencyKey: "terminal-shared",
      now: FIXED_NOW,
    });

    const { completeScheduleItem } = await import("@/modules/schedule/complete-schedule.service");

    await expect(
      completeScheduleItem(db, {
        actorId: studentId,
        scheduleItemId: itemId,
        idempotencyKey: "terminal-shared",
        now: FIXED_NOW,
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });
});
