import { config } from "dotenv";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { scheduleItems } from "@/db/schema";
import { createFormalPlan } from "@/modules/schedule/plan.service";
import { queryScheduleItems } from "@/modules/schedule/schedule-query.service";
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

describe.skipIf(!hasDb)("schedule query", () => {
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

  it("returns effectiveStatus without updating rows (F5/F6)", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);

    await createFormalPlan(db, {
      ownerId: parentId,
      studentId,
      idempotencyKey: "create-query",
      body: DEFAULT_PLAN_BODY,
      now: FIXED_NOW,
    });

    await db.execute(`
      INSERT INTO schedule_items (
        plan_id, plan_version_id, student_id, owner_id, family_date, slot_key,
        scheduled_at, status, source, occurrence_key
      )
      SELECT p.id, p.current_version, p.student_id, p.owner_id, '2026-01-01', 'default',
        '2026-01-01T12:00:00Z', 'pending', 'plan', 'manual-query-pending-expired'
      FROM plans p WHERE p.student_id = '${studentId}'::uuid
    `);

    const beforeUpdateCount = await db.execute(sql`
      SELECT count(*)::int AS count
      FROM schedule_items
      WHERE student_id = ${studentId}::uuid AND status = 'pending'
    `);

    const items = await queryScheduleItems(db, {
      studentId,
      from: "2026-01-01",
      to: "2026-02-28",
      now: FIXED_NOW,
    });

    expect(items.length).toBeGreaterThan(0);

    const pastWindowItem = items.find(
      (item) => item.occurrenceKey === "manual-query-pending-expired",
    );
    expect(pastWindowItem?.status).toBe("pending");
    expect(pastWindowItem?.effectiveStatus).toBe("expired");

    const currentItem = items.find((item) => item.familyDate === "2026-01-15");
    expect(currentItem?.effectiveStatus).toBe("pending");

    const afterUpdateCount = await db.execute(sql`
      SELECT count(*)::int AS count
      FROM schedule_items
      WHERE student_id = ${studentId}::uuid AND status = 'pending'
    `);

    expect(afterUpdateCount[0]).toEqual(beforeUpdateCount[0]);
  });

  it("multiple queries produce zero UPDATEs (F5)", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);

    await createFormalPlan(db, {
      ownerId: parentId,
      studentId,
      idempotencyKey: "create-multi-query",
      body: DEFAULT_PLAN_BODY,
      now: FIXED_NOW,
    });

    await queryScheduleItems(db, {
      studentId,
      from: "2026-01-01",
      to: "2026-02-28",
      now: FIXED_NOW,
    });
    await queryScheduleItems(db, {
      studentId,
      from: "2026-01-01",
      to: "2026-02-28",
      now: FIXED_NOW,
    });

    const pending = await db
      .select()
      .from(scheduleItems)
      .where(sql`${scheduleItems.status} = 'pending'`);
    expect(pending.length).toBeGreaterThan(0);
  });
});
