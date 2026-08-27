import { config } from "dotenv";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import "./helpers/auth-mock";
import { clearMockSessionCookie } from "./helpers/auth-mock";
import * as planService from "@/modules/schedule/plan.service";
import * as maintainService from "@/modules/schedule/maintain-horizon.service";
import * as completeService from "@/modules/schedule/complete-schedule.service";
import * as skipService from "@/modules/schedule/skip-schedule.service";
import * as pointRuleService from "@/modules/settlement/point-rule.service";
import { POST as createFormalPlanRoute } from "@/app/api/family/students/[studentId]/formal-plans/route";
import { POST as maintainHorizonRoute } from "@/app/api/family/students/[studentId]/formal-plans/maintain-horizon/route";
import { PATCH as editFormalPlanRoute } from "@/app/api/formal-plans/[planId]/route";
import { POST as deactivateFormalPlanRoute } from "@/app/api/formal-plans/[planId]/deactivate/route";
import { POST as completeScheduleRoute } from "@/app/api/schedule-items/[itemId]/complete/route";
import { POST as skipScheduleRoute } from "@/app/api/schedule-items/[itemId]/skip/route";
import { POST as enablePointRuleRoute } from "@/app/api/family/students/[studentId]/point-rules/route";
import { closeTestDb, migrateTestDb } from "../../helpers/db";

config({ path: ".env.local" });
config({ path: ".env" });

const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);
const studentId = "00000000-0000-4000-8000-000000000001";
const planId = "00000000-0000-4000-8000-000000000002";
const itemId = "00000000-0000-4000-8000-000000000003";

type RouteHandler = (
  request: Request,
  context: { params: Promise<Record<string, string>> },
) => Promise<Response>;

async function expectMissingIdempotencyKey(
  handler: RouteHandler,
  init: { method: string; url: string; body?: unknown; params: Record<string, string> },
) {
  const request = new Request(init.url, {
    method: init.method,
    headers: init.body ? { "content-type": "application/json" } : undefined,
    body: init.body ? JSON.stringify(init.body) : undefined,
  });

  const response = await handler(request, { params: Promise.resolve(init.params) });
  expect(response.status).toBe(400);

  const payload = await response.json();
  expect(payload).toEqual({
    error: "Idempotency-Key header is required",
    code: "IDEMPOTENCY_KEY_REQUIRED",
  });
}

describe.skipIf(!hasDb)("write route idempotency header (F23)", () => {
  beforeAll(async () => {
    await migrateTestDb();
  });

  beforeEach(() => {
    clearMockSessionCookie();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("POST formal-plans rejects missing header before domain (F23)", async () => {
    const spy = vi.spyOn(planService, "createFormalPlan");

    await expectMissingIdempotencyKey(createFormalPlanRoute as unknown as RouteHandler, {
      method: "POST",
      url: `http://localhost/api/family/students/${studentId}/formal-plans`,
      body: {
        title: "Daily",
        localTime: "20:00",
        startDate: "2026-01-01",
      },
      params: { studentId },
    });

    expect(spy).not.toHaveBeenCalled();
  });

  it("PATCH formal-plans rejects blank header before domain (F23)", async () => {
    const spy = vi.spyOn(planService, "editFormalPlan");

    const request = new Request(`http://localhost/api/formal-plans/${planId}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": "   ",
      },
      body: JSON.stringify({ title: "Updated" }),
    });

    const response = await editFormalPlanRoute(request, {
      params: Promise.resolve({ planId }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "IDEMPOTENCY_KEY_REQUIRED" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("POST deactivate rejects missing header before domain (F23)", async () => {
    const spy = vi.spyOn(planService, "deactivateFormalPlan");

    await expectMissingIdempotencyKey(deactivateFormalPlanRoute as unknown as RouteHandler, {
      method: "POST",
      url: `http://localhost/api/formal-plans/${planId}/deactivate`,
      params: { planId },
    });

    expect(spy).not.toHaveBeenCalled();
  });

  it("POST maintain-horizon rejects missing header before domain (F23)", async () => {
    const spy = vi.spyOn(maintainService, "maintainHorizon");

    await expectMissingIdempotencyKey(maintainHorizonRoute as unknown as RouteHandler, {
      method: "POST",
      url: `http://localhost/api/family/students/${studentId}/formal-plans/maintain-horizon`,
      params: { studentId },
    });

    expect(spy).not.toHaveBeenCalled();
  });

  it("POST complete rejects missing header before domain (F23)", async () => {
    const spy = vi.spyOn(completeService, "completeScheduleItem");

    await expectMissingIdempotencyKey(completeScheduleRoute as unknown as RouteHandler, {
      method: "POST",
      url: `http://localhost/api/schedule-items/${itemId}/complete`,
      params: { itemId },
    });

    expect(spy).not.toHaveBeenCalled();
  });

  it("POST skip rejects missing header before domain (F23)", async () => {
    const spy = vi.spyOn(skipService, "skipScheduleItem");

    await expectMissingIdempotencyKey(skipScheduleRoute as unknown as RouteHandler, {
      method: "POST",
      url: `http://localhost/api/schedule-items/${itemId}/skip`,
      body: { reason: "busy" },
      params: { itemId },
    });

    expect(spy).not.toHaveBeenCalled();
  });

  it("POST point-rules rejects missing header before domain (F23)", async () => {
    const spy = vi.spyOn(pointRuleService, "enablePointRule");

    await expectMissingIdempotencyKey(enablePointRuleRoute as unknown as RouteHandler, {
      method: "POST",
      url: `http://localhost/api/family/students/${studentId}/point-rules`,
      body: { templateId: "schedule_system_complete_v1" },
      params: { studentId },
    });

    expect(spy).not.toHaveBeenCalled();
  });
});
