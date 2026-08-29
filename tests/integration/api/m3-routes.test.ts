import { config } from "dotenv";
import { asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import "./helpers/auth-mock";
import { clearMockSessionCookie } from "./helpers/auth-mock";
import { bootstrapLinkedParentStudent, withSessionCookie } from "./helpers/session";
import { POST as submitErrorCountRoute } from "@/app/api/schedule-items/[itemId]/facts/error-count/route";
import { POST as confirmFactRoute } from "@/app/api/facts/[factId]/confirm/route";
import { POST as correctFactRoute } from "@/app/api/facts/[factId]/correct/route";
import { GET as listDeadOutboxRoute } from "@/app/api/admin/outbox/dead/route";
import { createFormalPlan } from "@/modules/schedule/plan.service";
import { maintainHorizon } from "@/modules/schedule/maintain-horizon.service";
import { scheduleItems } from "@/db/schema";
import {
  DEFAULT_PLAN_BODY,
  enableErrorCountPointRule,
  resetScheduleTables,
} from "../../helpers/schedule";
import { closeTestDb, getTestDb, migrateTestDb, resetIdentityTables } from "../../helpers/db";
import { bootstrapAdmin } from "../../helpers/identity";

config({ path: ".env.local" });
config({ path: ".env" });

const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);
const WITHIN_WINDOW_NOW = new Date("2026-01-05T04:00:00.000Z");

describe.skipIf(!hasDb)("m3 api routes", () => {
  const db = getTestDb();

  beforeAll(async () => {
    await migrateTestDb();
  });

  beforeEach(async () => {
    clearMockSessionCookie();
    vi.restoreAllMocks();
    await resetIdentityTables(db);
    await resetScheduleTables(db);
  });

  afterAll(async () => {
    await closeTestDb();
  });

  async function seedItem() {
    const linked = await bootstrapLinkedParentStudent(db);
    withSessionCookie(linked.parentSession);

    await enableErrorCountPointRule(db, {
      parentId: linked.parentId,
      studentId: linked.studentId,
    });

    await createFormalPlan(db, {
      ownerId: linked.parentId,
      studentId: linked.studentId,
      idempotencyKey: `plan-api-${linked.studentId}`,
      body: DEFAULT_PLAN_BODY,
      now: WITHIN_WINDOW_NOW,
    });

    await maintainHorizon(db, {
      actorId: linked.parentId,
      studentId: linked.studentId,
      idempotencyKey: `horizon-api-${linked.studentId}`,
      now: WITHIN_WINDOW_NOW,
    });

    const [item] = await db
      .select()
      .from(scheduleItems)
      .where(eq(scheduleItems.studentId, linked.studentId))
      .orderBy(asc(scheduleItems.familyDate))
      .limit(1);

    return { linked, itemId: item!.id };
  }

  it("POST error-count returns 400 without Idempotency-Key", async () => {
    const { linked, itemId } = await seedItem();
    withSessionCookie(linked.studentSession);

    const response = await submitErrorCountRoute(
      new Request(`http://localhost/api/schedule-items/${itemId}/facts/error-count`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ errorCount: 1 }),
      }),
      { params: Promise.resolve({ itemId }) },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "IDEMPOTENCY_KEY_REQUIRED" },
    });
  });

  it("POST error-count returns 403 for parent session", async () => {
    const { linked, itemId } = await seedItem();
    withSessionCookie(linked.parentSession);

    const response = await submitErrorCountRoute(
      new Request(`http://localhost/api/schedule-items/${itemId}/facts/error-count`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": "parent-submit",
        },
        body: JSON.stringify({ errorCount: 1 }),
      }),
      { params: Promise.resolve({ itemId }) },
    );

    expect(response.status).toBe(403);
  });

  it("POST confirm returns 403 for student session", async () => {
    const { linked, itemId } = await seedItem();
    withSessionCookie(linked.studentSession);

    const submitResponse = await submitErrorCountRoute(
      new Request(`http://localhost/api/schedule-items/${itemId}/facts/error-count`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": "student-submit",
        },
        body: JSON.stringify({ errorCount: 1 }),
      }),
      { params: Promise.resolve({ itemId }) },
    );
    const submitPayload = await submitResponse.json();

    withSessionCookie(linked.studentSession);
    const response = await confirmFactRoute(
      new Request(`http://localhost/api/facts/${submitPayload.factVersionId}/confirm`, {
        method: "POST",
        headers: { "Idempotency-Key": "student-confirm" },
      }),
      { params: Promise.resolve({ factId: submitPayload.factVersionId }) },
    );

    expect(response.status).toBe(403);
  });

  it("GET admin dead outbox returns 403 for parent", async () => {
    const { linked } = await seedItem();
    withSessionCookie(linked.parentSession);

    const response = await listDeadOutboxRoute(new Request("http://localhost/api/admin/outbox/dead"));
    expect(response.status).toBe(403);
  });

  it("GET admin dead outbox succeeds for admin", async () => {
    const admin = await bootstrapAdmin(db);
    withSessionCookie(admin.session);

    const response = await listDeadOutboxRoute(new Request("http://localhost/api/admin/outbox/dead"));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.events).toBeDefined();
  });
});
