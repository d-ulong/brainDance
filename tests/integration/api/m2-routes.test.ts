import { config } from "dotenv";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import "./helpers/auth-mock";
import { clearMockSessionCookie } from "./helpers/auth-mock";
import { bootstrapLinkedParentStudent, withSessionCookie } from "./helpers/session";
import { POST as createFormalPlanRoute } from "@/app/api/family/students/[studentId]/formal-plans/route";
import { GET as getCurrentPlanRoute } from "@/app/api/family/students/[studentId]/formal-plans/current/route";
import { GET as getScheduleItemsRoute } from "@/app/api/family/students/[studentId]/schedule-items/route";
import { POST as completeScheduleRoute } from "@/app/api/schedule-items/[itemId]/complete/route";
import { POST as enablePointRuleRoute } from "@/app/api/family/students/[studentId]/point-rules/route";
import { GET as getPointsBalanceRoute } from "@/app/api/family/students/[studentId]/points/balance/route";
import {
  bootstrapParentStudentRelationship,
  DEFAULT_PLAN_BODY,
  resetScheduleTables,
} from "../../helpers/schedule";
import { closeTestDb, getTestDb, migrateTestDb, resetIdentityTables } from "../../helpers/db";
import { toFamilyDate } from "@/modules/time-policy/to-family-date";

config({ path: ".env.local" });
config({ path: ".env" });

const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);

function todayFamilyDate() {
  return toFamilyDate(new Date());
}

describe.skipIf(!hasDb)("m2 api routes", () => {
  const db = getTestDb();

  beforeAll(async () => {
    await migrateTestDb();
  });

  beforeEach(async () => {
    clearMockSessionCookie();
    await resetIdentityTables(db);
    await resetScheduleTables(db);
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("creates formal plan via POST route (success path)", async () => {
    const linked = await bootstrapLinkedParentStudent(db);
    withSessionCookie(linked.parentSession);

    const response = await createFormalPlanRoute(
      new Request(`http://localhost/api/family/students/${linked.studentId}/formal-plans`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": "route-create-plan",
        },
        body: JSON.stringify({
          ...DEFAULT_PLAN_BODY,
          startDate: "2026-01-01",
        }),
      }),
      { params: Promise.resolve({ studentId: linked.studentId }) },
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.planId).toBeTruthy();
    expect(payload.versionId).toBeTruthy();
    expect(payload.localTime).toBe("20:00");
  });

  it("returns 403 when parent creates plan for unrelated student (auth)", async () => {
    const linked = await bootstrapLinkedParentStudent(db);
    const other = await bootstrapParentStudentRelationship(db);
    withSessionCookie(linked.parentSession);

    const response = await createFormalPlanRoute(
      new Request(`http://localhost/api/family/students/${other.studentId}/formal-plans`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": "route-create-forbidden",
        },
        body: JSON.stringify(DEFAULT_PLAN_BODY),
      }),
      { params: Promise.resolve({ studentId: other.studentId }) },
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "FORBIDDEN" });
  });

  it("returns 400 for invalid create body (DTO validation)", async () => {
    const linked = await bootstrapLinkedParentStudent(db);
    withSessionCookie(linked.parentSession);

    const response = await createFormalPlanRoute(
      new Request(`http://localhost/api/family/students/${linked.studentId}/formal-plans`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": "route-create-invalid",
        },
        body: JSON.stringify({ title: "Missing fields" }),
      }),
      { params: Promise.resolve({ studentId: linked.studentId }) },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("maps active plan conflict to 409 (domain error)", async () => {
    const linked = await bootstrapLinkedParentStudent(db);
    withSessionCookie(linked.parentSession);

    const body = JSON.stringify({
      ...DEFAULT_PLAN_BODY,
      startDate: "2026-01-01",
    });
    const headers = {
      "content-type": "application/json",
      "Idempotency-Key": "route-create-active",
    };

    const first = await createFormalPlanRoute(
      new Request(`http://localhost/api/family/students/${linked.studentId}/formal-plans`, {
        method: "POST",
        headers,
        body,
      }),
      { params: Promise.resolve({ studentId: linked.studentId }) },
    );
    expect(first.status).toBe(200);

    const second = await createFormalPlanRoute(
      new Request(`http://localhost/api/family/students/${linked.studentId}/formal-plans`, {
        method: "POST",
        headers: { ...headers, "Idempotency-Key": "route-create-active-2" },
        body,
      }),
      { params: Promise.resolve({ studentId: linked.studentId }) },
    );

    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ code: "STATE_CONFLICT" });
  });

  it("GET current plan and schedule-items are read-only (NF-4/F5)", async () => {
    const linked = await bootstrapLinkedParentStudent(db);
    withSessionCookie(linked.parentSession);

    await createFormalPlanRoute(
      new Request(`http://localhost/api/family/students/${linked.studentId}/formal-plans`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": "route-readonly-setup",
        },
        body: JSON.stringify({
          ...DEFAULT_PLAN_BODY,
          startDate: todayFamilyDate(),
        }),
      }),
      { params: Promise.resolve({ studentId: linked.studentId }) },
    );

    const beforeCounts = await db.execute(sql`
      SELECT
        (SELECT count(*)::int FROM schedule_horizon_maintains) AS maintains,
        (SELECT count(*)::int FROM schedule_items WHERE status = 'expired') AS expired
    `);
    const before = beforeCounts[0] as { maintains: number; expired: number };

    const currentResponse = await getCurrentPlanRoute(
      new Request(`http://localhost/api/family/students/${linked.studentId}/formal-plans/current`),
      { params: Promise.resolve({ studentId: linked.studentId }) },
    );
    expect(currentResponse.status).toBe(200);
    const currentPayload = await currentResponse.json();
    expect(currentPayload.plan?.localTime).toBe("20:00");

    const itemsResponse = await getScheduleItemsRoute(
      new Request(
        `http://localhost/api/family/students/${linked.studentId}/schedule-items?from=${todayFamilyDate()}&to=${todayFamilyDate()}`,
      ),
      { params: Promise.resolve({ studentId: linked.studentId }) },
    );
    expect(itemsResponse.status).toBe(200);
    const itemsPayload = await itemsResponse.json();
    expect(itemsPayload.items.length).toBeGreaterThan(0);

    withSessionCookie(linked.studentSession);
    const studentItemsResponse = await getScheduleItemsRoute(
      new Request(
        `http://localhost/api/family/students/${linked.studentId}/schedule-items?from=${todayFamilyDate()}&to=${todayFamilyDate()}`,
      ),
      { params: Promise.resolve({ studentId: linked.studentId }) },
    );
    expect(studentItemsResponse.status).toBe(200);

    const afterCounts = await db.execute(sql`
      SELECT
        (SELECT count(*)::int FROM schedule_horizon_maintains) AS maintains,
        (SELECT count(*)::int FROM schedule_items WHERE status = 'expired') AS expired
    `);
    const after = afterCounts[0] as { maintains: number; expired: number };

    expect(after).toEqual(before);
  });

  it("completes schedule item and exposes balance via GET routes", async () => {
    const linked = await bootstrapLinkedParentStudent(db);
    withSessionCookie(linked.parentSession);

    const created = await createFormalPlanRoute(
      new Request(`http://localhost/api/family/students/${linked.studentId}/formal-plans`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": "route-complete-setup-plan",
        },
        body: JSON.stringify({
          ...DEFAULT_PLAN_BODY,
          startDate: todayFamilyDate(),
        }),
      }),
      { params: Promise.resolve({ studentId: linked.studentId }) },
    );
    expect(created.status).toBe(200);
    const createdPayload = await created.json();

    await enablePointRuleRoute(
      new Request(`http://localhost/api/family/students/${linked.studentId}/point-rules`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": "route-complete-setup-rule",
        },
        body: JSON.stringify({ templateId: "schedule_system_complete_v1" }),
      }),
      { params: Promise.resolve({ studentId: linked.studentId }) },
    );

    const items = await db.execute(sql`
      SELECT id FROM schedule_items
      WHERE plan_id = ${createdPayload.planId}::uuid
      ORDER BY family_date ASC
      LIMIT 1
    `);
    const itemId = (items[0] as { id: string }).id;

    withSessionCookie(linked.studentSession);
    const completeResponse = await completeScheduleRoute(
      new Request(`http://localhost/api/schedule-items/${itemId}/complete`, {
        method: "POST",
        headers: { "Idempotency-Key": "route-complete-item" },
      }),
      { params: Promise.resolve({ itemId }) },
    );

    expect(completeResponse.status).toBe(200);
    const completePayload = await completeResponse.json();
    expect(completePayload.ledgerEntryId).toBeTruthy();

    withSessionCookie(linked.parentSession);
    const balanceResponse = await getPointsBalanceRoute(
      new Request(`http://localhost/api/family/students/${linked.studentId}/points/balance`),
      { params: Promise.resolve({ studentId: linked.studentId }) },
    );
    expect(balanceResponse.status).toBe(200);
    expect(await balanceResponse.json()).toMatchObject({ balance: 10 });
  });

  it("returns 403 when parent attempts complete (auth)", async () => {
    const linked = await bootstrapLinkedParentStudent(db);
    withSessionCookie(linked.parentSession);

    const created = await createFormalPlanRoute(
      new Request(`http://localhost/api/family/students/${linked.studentId}/formal-plans`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": "route-parent-complete-plan",
        },
        body: JSON.stringify({
          ...DEFAULT_PLAN_BODY,
          startDate: todayFamilyDate(),
        }),
      }),
      { params: Promise.resolve({ studentId: linked.studentId }) },
    );
    const createdPayload = await created.json();

    const items = await db.execute(sql`
      SELECT id FROM schedule_items
      WHERE plan_id = ${createdPayload.planId}::uuid
      LIMIT 1
    `);
    const itemId = (items[0] as { id: string }).id;

    const response = await completeScheduleRoute(
      new Request(`http://localhost/api/schedule-items/${itemId}/complete`, {
        method: "POST",
        headers: { "Idempotency-Key": "route-parent-complete" },
      }),
      { params: Promise.resolve({ itemId }) },
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "FORBIDDEN" });
  });
});
