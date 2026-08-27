import { config } from "dotenv";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import "./helpers/auth-mock";
import { clearMockSessionCookie } from "./helpers/auth-mock";
import * as authRequest from "@/lib/auth-request";
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

const IDEMPOTENCY_ENVELOPE = {
  error: {
    code: "IDEMPOTENCY_KEY_REQUIRED",
    message: "Idempotency-Key header is required",
  },
};

type RouteHandler = (
  request: Request,
  context: { params: Promise<Record<string, string>> },
) => Promise<Response>;

type InvalidHeaderCase = "missing" | "blank";

type WriteRouteCase = {
  label: string;
  handler: RouteHandler;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  domainSpy: () => any;
  init: {
    method: string;
    url: string;
    body?: unknown;
    params: Record<string, string>;
  };
};

const WRITE_ROUTES: WriteRouteCase[] = [
  {
    label: "POST /formal-plans",
    handler: createFormalPlanRoute as unknown as RouteHandler,
    domainSpy: () => vi.spyOn(planService, "createFormalPlan"),
    init: {
      method: "POST",
      url: `http://localhost/api/family/students/${studentId}/formal-plans`,
      body: { title: "Daily", localTime: "20:00", startDate: "2026-01-01" },
      params: { studentId },
    },
  },
  {
    label: "PATCH /formal-plans/[planId]",
    handler: editFormalPlanRoute as unknown as RouteHandler,
    domainSpy: () => vi.spyOn(planService, "editFormalPlan"),
    init: {
      method: "PATCH",
      url: `http://localhost/api/formal-plans/${planId}`,
      body: { title: "Updated" },
      params: { planId },
    },
  },
  {
    label: "POST /formal-plans/[planId]/deactivate",
    handler: deactivateFormalPlanRoute as unknown as RouteHandler,
    domainSpy: () => vi.spyOn(planService, "deactivateFormalPlan"),
    init: {
      method: "POST",
      url: `http://localhost/api/formal-plans/${planId}/deactivate`,
      params: { planId },
    },
  },
  {
    label: "POST /formal-plans/maintain-horizon",
    handler: maintainHorizonRoute as unknown as RouteHandler,
    domainSpy: () => vi.spyOn(maintainService, "maintainHorizon"),
    init: {
      method: "POST",
      url: `http://localhost/api/family/students/${studentId}/formal-plans/maintain-horizon`,
      params: { studentId },
    },
  },
  {
    label: "POST /schedule-items/[itemId]/complete",
    handler: completeScheduleRoute as unknown as RouteHandler,
    domainSpy: () => vi.spyOn(completeService, "completeScheduleItem"),
    init: {
      method: "POST",
      url: `http://localhost/api/schedule-items/${itemId}/complete`,
      params: { itemId },
    },
  },
  {
    label: "POST /schedule-items/[itemId]/skip",
    handler: skipScheduleRoute as unknown as RouteHandler,
    domainSpy: () => vi.spyOn(skipService, "skipScheduleItem"),
    init: {
      method: "POST",
      url: `http://localhost/api/schedule-items/${itemId}/skip`,
      body: { reason: "busy" },
      params: { itemId },
    },
  },
  {
    label: "POST /point-rules",
    handler: enablePointRuleRoute as unknown as RouteHandler,
    domainSpy: () => vi.spyOn(pointRuleService, "enablePointRule"),
    init: {
      method: "POST",
      url: `http://localhost/api/family/students/${studentId}/point-rules`,
      body: { templateId: "schedule_system_complete_v1" },
      params: { studentId },
    },
  },
];

const INVALID_HEADER_CASES: InvalidHeaderCase[] = ["missing", "blank"];

async function invokeWithInvalidHeader(
  route: WriteRouteCase,
  headerCase: InvalidHeaderCase,
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (route.init.body) {
    headers["content-type"] = "application/json";
  }
  if (headerCase === "blank") {
    headers["Idempotency-Key"] = "   ";
  }

  const request = new Request(route.init.url, {
    method: route.init.method,
    headers,
    body: route.init.body ? JSON.stringify(route.init.body) : undefined,
  });

  return route.handler(request, { params: Promise.resolve(route.init.params) });
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

  it.each(
    WRITE_ROUTES.flatMap((route) =>
      INVALID_HEADER_CASES.map((headerCase) => [route.label, headerCase, route] as const),
    ),
  )("%s rejects %s header before auth/domain (F23)", async (_label, headerCase, route) => {
    const domainSpy = route.domainSpy();
    const parentAuthSpy = vi.spyOn(authRequest, "requireVerifiedParentSession");
    const studentAuthSpy = vi.spyOn(authRequest, "requireStudentSessionForWrites");
    const sessionAuthSpy = vi.spyOn(authRequest, "requireAuthenticatedSession");

    const response = await invokeWithInvalidHeader(route, headerCase);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(IDEMPOTENCY_ENVELOPE);
    expect(parentAuthSpy).not.toHaveBeenCalled();
    expect(studentAuthSpy).not.toHaveBeenCalled();
    expect(sessionAuthSpy).not.toHaveBeenCalled();
    expect(domainSpy).not.toHaveBeenCalled();
  });

  it.each(WRITE_ROUTES.map((route) => [route.label, route] as const))(
    "%s passes raw Idempotency-Key with surrounding spaces to domain (F23)",
    async (_label, route) => {
      const rawKey = "  route-key-with-spaces  ";
      const mockAuth = {
        db: {} as never,
        dbUser: {
          id: "00000000-0000-4000-8000-000000000099",
          role: "parent" as const,
          contactVerifiedAt: new Date(),
        },
        session: {} as never,
        user: {} as never,
      };
      const mockStudentAuth = {
        ...mockAuth,
        dbUser: { ...mockAuth.dbUser, role: "student" as const },
      };

      vi.spyOn(authRequest, "requireVerifiedParentSession").mockResolvedValue(mockAuth as never);
      vi.spyOn(authRequest, "requireStudentSessionForWrites").mockResolvedValue(
        mockStudentAuth as never,
      );
      vi.spyOn(authRequest, "requireAuthenticatedSession").mockResolvedValue(mockAuth as never);

      const domainSpy = route.domainSpy().mockRejectedValue(new Error("stop-after-key-check"));

      const headers: Record<string, string> = {
        "Idempotency-Key": rawKey,
      };
      if (route.init.body) {
        headers["content-type"] = "application/json";
      }

      const baseRequest = new Request(route.init.url, {
        method: route.init.method,
        headers,
        body: route.init.body ? JSON.stringify(route.init.body) : undefined,
      });
      const request = new Request(baseRequest.url, baseRequest);
      vi.spyOn(request.headers, "get").mockImplementation((name) => {
        if (name.toLowerCase() === "idempotency-key") {
          return rawKey;
        }
        return baseRequest.headers.get(name);
      });

      await route.handler(request, { params: Promise.resolve(route.init.params) });

      expect(domainSpy).toHaveBeenCalledOnce();
      const callArg = domainSpy.mock.calls[0]?.[1] as { idempotencyKey?: string };
      expect(callArg.idempotencyKey).toBe(rawKey);
    },
  );
});
