import { config } from "dotenv";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import "./helpers/auth-mock";
import { clearMockSessionCookie } from "./helpers/auth-mock";
import { bootstrapLinkedParentStudent, withSessionCookie } from "./helpers/session";
import { POST as submitErrorCountRoute } from "@/app/api/schedule-items/[itemId]/facts/error-count/route";
import { POST as confirmFactRoute } from "@/app/api/facts/[factId]/confirm/route";
import { POST as correctFactRoute } from "@/app/api/facts/[factId]/correct/route";
import { GET as listDeadOutboxRoute } from "@/app/api/admin/outbox/dead/route";
import { POST as replayOutboxRoute } from "@/app/api/admin/outbox/[eventId]/replay/route";
import { createFormalPlan } from "@/modules/schedule/plan.service";
import { maintainHorizon } from "@/modules/schedule/maintain-horizon.service";
import { appendOutboxEvent } from "@/modules/outbox/append-outbox-event";
import { auditEvents, outboxEvents, scheduleItems } from "@/db/schema";
import {
  DEFAULT_PLAN_BODY,
  enableErrorCountPointRule,
  resetScheduleTables,
} from "../../helpers/schedule";
import { closeTestDb, getTestDb, migrateTestDb, resetIdentityTables } from "../../helpers/db";
import { bootstrapAdmin } from "../../helpers/identity";
import { toFamilyDate } from "@/modules/time-policy/to-family-date";
import { addFamilyDays } from "@/modules/time-policy/add-family-days";

config({ path: ".env.local" });
config({ path: ".env" });

const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);

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
    const now = new Date();
    const startDate = addFamilyDays(toFamilyDate(now), -3);

    await enableErrorCountPointRule(db, {
      parentId: linked.parentId,
      studentId: linked.studentId,
    });

    await createFormalPlan(db, {
      ownerId: linked.parentId,
      studentId: linked.studentId,
      idempotencyKey: `plan-api-${linked.studentId}`,
      body: { ...DEFAULT_PLAN_BODY, startDate },
      now,
    });

    await maintainHorizon(db, {
      actorId: linked.parentId,
      studentId: linked.studentId,
      idempotencyKey: `horizon-api-${linked.studentId}`,
      now,
    });

    const [item] = await db
      .select()
      .from(scheduleItems)
      .where(eq(scheduleItems.studentId, linked.studentId))
      .orderBy(asc(scheduleItems.familyDate))
      .limit(1);

    return { linked, itemId: item!.id, familyDate: item!.familyDate };
  }

  async function seedConfirmedFact() {
    const { linked, itemId, familyDate } = await seedItem();
    withSessionCookie(linked.studentSession);

    const submitResponse = await submitErrorCountRoute(
      new Request(`http://localhost/api/schedule-items/${itemId}/facts/error-count`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": "route-submit",
        },
        body: JSON.stringify({ errorCount: 1 }),
      }),
      { params: Promise.resolve({ itemId }) },
    );
    expect(submitResponse.status).toBe(200);
    const submitPayload = await submitResponse.json();

    withSessionCookie(linked.parentSession);
    const confirmResponse = await confirmFactRoute(
      new Request(`http://localhost/api/facts/${submitPayload.factVersionId}/confirm`, {
        method: "POST",
        headers: { "Idempotency-Key": "route-confirm" },
      }),
      { params: Promise.resolve({ factId: submitPayload.factVersionId }) },
    );
    expect(confirmResponse.status).toBe(200);

    return {
      linked,
      itemId,
      familyDate,
      factId: submitPayload.factVersionId as string,
    };
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

    const response = await listDeadOutboxRoute(
      new Request("http://localhost/api/admin/outbox/dead"),
    );
    expect(response.status).toBe(403);
  });

  it("GET admin dead outbox succeeds for admin", async () => {
    const admin = await bootstrapAdmin(db);
    withSessionCookie(admin.session);

    const response = await listDeadOutboxRoute(
      new Request("http://localhost/api/admin/outbox/dead"),
    );
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.events).toBeDefined();
  });

  it("POST correct returns 400 without Idempotency-Key", async () => {
    const { factId } = await seedConfirmedFact();

    const response = await correctFactRoute(
      new Request(`http://localhost/api/facts/${factId}/correct`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ errorCount: 2, reason: "fix" }),
      }),
      { params: Promise.resolve({ factId }) },
    );

    expect(response.status).toBe(400);
  });

  it("POST correct returns 403 for student session", async () => {
    const { linked, factId } = await seedConfirmedFact();
    withSessionCookie(linked.studentSession);

    const response = await correctFactRoute(
      new Request(`http://localhost/api/facts/${factId}/correct`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": "student-correct",
        },
        body: JSON.stringify({ errorCount: 2, reason: "fix" }),
      }),
      { params: Promise.resolve({ factId }) },
    );

    expect(response.status).toBe(403);
  });

  it("POST correct returns 409 outside parent correction window", async () => {
    const linked = await bootstrapLinkedParentStudent(db);
    withSessionCookie(linked.parentSession);
    const planNow = new Date("2026-01-05T04:00:00.000Z");

    await enableErrorCountPointRule(db, {
      parentId: linked.parentId,
      studentId: linked.studentId,
    });

    await createFormalPlan(db, {
      ownerId: linked.parentId,
      studentId: linked.studentId,
      idempotencyKey: `plan-window-${linked.studentId}`,
      body: DEFAULT_PLAN_BODY,
      now: planNow,
    });

    await maintainHorizon(db, {
      actorId: linked.parentId,
      studentId: linked.studentId,
      idempotencyKey: `horizon-window-${linked.studentId}`,
      now: planNow,
    });

    const [item] = await db
      .select()
      .from(scheduleItems)
      .where(eq(scheduleItems.studentId, linked.studentId))
      .orderBy(asc(scheduleItems.familyDate))
      .limit(1);

    withSessionCookie(linked.studentSession);
    const submitResponse = await submitErrorCountRoute(
      new Request(`http://localhost/api/schedule-items/${item!.id}/facts/error-count`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": "window-submit",
        },
        body: JSON.stringify({ errorCount: 1 }),
      }),
      { params: Promise.resolve({ itemId: item!.id }) },
    );
    expect(submitResponse.status).toBe(200);
    const submitPayload = await submitResponse.json();

    withSessionCookie(linked.parentSession);
    const confirmResponse = await confirmFactRoute(
      new Request(`http://localhost/api/facts/${submitPayload.factVersionId}/confirm`, {
        method: "POST",
        headers: { "Idempotency-Key": "window-confirm" },
      }),
      { params: Promise.resolve({ factId: submitPayload.factVersionId }) },
    );
    expect(confirmResponse.status).toBe(200);

    const response = await correctFactRoute(
      new Request(`http://localhost/api/facts/${submitPayload.factVersionId}/correct`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": "window-correct",
        },
        body: JSON.stringify({ errorCount: 2, reason: "too late" }),
      }),
      { params: Promise.resolve({ factId: submitPayload.factVersionId }) },
    );

    expect(response.status).toBe(409);
    const payload = await response.json();
    expect(payload.error?.code).toBe("WINDOW_EXPIRED");
  });

  it("POST correct with invalid adminReason returns 400 for parent path", async () => {
    const { linked, factId } = await seedConfirmedFact();
    withSessionCookie(linked.parentSession);

    const response = await correctFactRoute(
      new Request(`http://localhost/api/facts/${factId}/correct`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": "invalid-admin-reason",
        },
        body: JSON.stringify({ errorCount: 2, reason: "fix", adminReason: "not_allowed" }),
      }),
      { params: Promise.resolve({ factId }) },
    );

    expect(response.status).toBe(400);
  });

  it("F-R01 POST correct admin security returns 200 with successor reversal audit outbox", async () => {
    const { factId } = await seedConfirmedFact();
    const admin = await bootstrapAdmin(db);
    withSessionCookie(admin.session);

    const response = await correctFactRoute(
      new Request(`http://localhost/api/facts/${factId}/correct`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": "admin-correct-security",
        },
        body: JSON.stringify({
          errorCount: 2,
          reason: "security fix",
          adminReason: "security",
        }),
      }),
      { params: Promise.resolve({ factId }) },
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.successorFactId).toBeTruthy();
    expect(payload.reversalLedgerEntryIds?.length).toBeGreaterThan(0);

    const auditRows = await db.select().from(auditEvents);
    expect(auditRows.some((row) => row.action === "fact.corrected.admin")).toBe(true);

    const outboxRows = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.eventType, "fact.corrected"));
    expect(outboxRows.some((row) => row.aggregateId === payload.successorFactId)).toBe(true);
  });

  it("F-R01 POST correct admin data_correction returns 200", async () => {
    const { factId } = await seedConfirmedFact();
    const admin = await bootstrapAdmin(db);
    withSessionCookie(admin.session);

    const response = await correctFactRoute(
      new Request(`http://localhost/api/facts/${factId}/correct`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": "admin-correct-data",
        },
        body: JSON.stringify({
          errorCount: 0,
          reason: "data fix",
          adminReason: "data_correction",
        }),
      }),
      { params: Promise.resolve({ factId }) },
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.successorFactId).toBeTruthy();
  });

  it("POST correct with adminReason returns 403 for parent session", async () => {
    const { linked, factId } = await seedConfirmedFact();
    withSessionCookie(linked.parentSession);

    const response = await correctFactRoute(
      new Request(`http://localhost/api/facts/${factId}/correct`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": "parent-admin-reason",
        },
        body: JSON.stringify({
          errorCount: 2,
          reason: "fix",
          adminReason: "security",
        }),
      }),
      { params: Promise.resolve({ factId }) },
    );

    expect(response.status).toBe(403);
  });

  it("POST replay returns 400 without Idempotency-Key", async () => {
    const admin = await bootstrapAdmin(db);
    withSessionCookie(admin.session);

    const eventId = crypto.randomUUID();
    const response = await replayOutboxRoute(
      new Request(`http://localhost/api/admin/outbox/${eventId}/replay`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "retry" }),
      }),
      { params: Promise.resolve({ eventId }) },
    );

    expect(response.status).toBe(400);
  });

  it("POST replay returns 403 for parent", async () => {
    const { linked } = await seedItem();
    withSessionCookie(linked.parentSession);

    const response = await replayOutboxRoute(
      new Request(`http://localhost/api/admin/outbox/${crypto.randomUUID()}/replay`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": "parent-replay",
        },
        body: JSON.stringify({ reason: "retry" }),
      }),
      { params: Promise.resolve({ eventId: crypto.randomUUID() }) },
    );

    expect(response.status).toBe(403);
  });

  it("POST replay succeeds for admin dead event", async () => {
    const admin = await bootstrapAdmin(db);
    withSessionCookie(admin.session);

    const eventId = await appendOutboxEvent(db, {
      aggregateType: "unknown",
      aggregateId: crypto.randomUUID(),
      eventType: "unknown.event",
      dedupeKey: `route-replay-${crypto.randomUUID()}`,
      payload: {},
    });

    await db
      .update(outboxEvents)
      .set({ status: "dead", attempts: 5 })
      .where(eq(outboxEvents.id, eventId));

    const response = await replayOutboxRoute(
      new Request(`http://localhost/api/admin/outbox/${eventId}/replay`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": "admin-replay",
        },
        body: JSON.stringify({ reason: "operator retry" }),
      }),
      { params: Promise.resolve({ eventId }) },
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.idempotentReplay).toBe(false);

    const auditRows = await db.select().from(auditEvents);
    expect(auditRows.some((row) => row.action === "outbox.replayed")).toBe(true);
  });

  it("POST replay returns 409 for non-dead event", async () => {
    const admin = await bootstrapAdmin(db);
    withSessionCookie(admin.session);

    const eventId = await appendOutboxEvent(db, {
      aggregateType: "unknown",
      aggregateId: crypto.randomUUID(),
      eventType: "unknown.event",
      dedupeKey: `route-replay-pending-${crypto.randomUUID()}`,
      payload: {},
    });

    const response = await replayOutboxRoute(
      new Request(`http://localhost/api/admin/outbox/${eventId}/replay`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": "admin-replay-conflict",
        },
        body: JSON.stringify({ reason: "too early" }),
      }),
      { params: Promise.resolve({ eventId }) },
    );

    expect(response.status).toBe(409);
  });
});
