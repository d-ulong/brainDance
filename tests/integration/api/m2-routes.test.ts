import { config } from "dotenv";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import "./helpers/auth-mock";
import { clearMockSessionCookie } from "./helpers/auth-mock";
import { bootstrapLinkedParentStudent, withSessionCookie } from "./helpers/session";
import { POST as createFormalPlanRoute } from "@/app/api/family/students/[studentId]/formal-plans/route";
import { POST as maintainHorizonRoute } from "@/app/api/family/students/[studentId]/formal-plans/maintain-horizon/route";
import { GET as getCurrentPlanRoute } from "@/app/api/family/students/[studentId]/formal-plans/current/route";
import { PATCH as editFormalPlanRoute } from "@/app/api/formal-plans/[planId]/route";
import { POST as deactivateFormalPlanRoute } from "@/app/api/formal-plans/[planId]/deactivate/route";
import { GET as getScheduleItemsRoute } from "@/app/api/family/students/[studentId]/schedule-items/route";
import { POST as completeScheduleRoute } from "@/app/api/schedule-items/[itemId]/complete/route";
import { POST as skipScheduleRoute } from "@/app/api/schedule-items/[itemId]/skip/route";
import { POST as enablePointRuleRoute } from "@/app/api/family/students/[studentId]/point-rules/route";
import { GET as getPointsBalanceRoute } from "@/app/api/family/students/[studentId]/points/balance/route";
import { GET as getPointsLedgerRoute } from "@/app/api/family/students/[studentId]/points/ledger/route";
import * as planService from "@/modules/schedule/plan.service";
import * as maintainService from "@/modules/schedule/maintain-horizon.service";
import * as completeService from "@/modules/schedule/complete-schedule.service";
import * as skipService from "@/modules/schedule/skip-schedule.service";
import * as scheduleQuery from "@/modules/schedule/schedule-query.service";
import * as pointRuleService from "@/modules/settlement/point-rule.service";
import * as ledgerService from "@/modules/settlement/ledger.service";
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

const VALIDATION_ERROR_ENVELOPE = {
  error: { code: "VALIDATION_ERROR", message: "Validation failed" },
};

function expectValidationEnvelope(payload: unknown) {
  expect(payload).toEqual(VALIDATION_ERROR_ENVELOPE);
}

async function createPlanViaRoute(
  studentId: string,
  idempotencyKey: string,
  startDate = "2026-01-01",
) {
  return createFormalPlanRoute(
    new Request(`http://localhost/api/family/students/${studentId}/formal-plans`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({ ...DEFAULT_PLAN_BODY, startDate }),
    }),
    { params: Promise.resolve({ studentId }) },
  );
}

describe.skipIf(!hasDb)("m2 api routes", () => {
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

  describe("POST /formal-plans", () => {
    it("creates formal plan (success path)", async () => {
      const linked = await bootstrapLinkedParentStudent(db);
      withSessionCookie(linked.parentSession);

      const response = await createPlanViaRoute(linked.studentId, "route-create-plan");
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.planId).toBeTruthy();
      expect(payload.versionId).toBeTruthy();
      expect(payload.localTime).toBe("20:00");
    });

    it("returns 403 for unrelated student (auth)", async () => {
      const linked = await bootstrapLinkedParentStudent(db);
      const other = await bootstrapParentStudentRelationship(db);
      withSessionCookie(linked.parentSession);

      const response = await createPlanViaRoute(other.studentId, "route-create-forbidden");
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
    });

    it("returns 400 for invalid body (DTO validation)", async () => {
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
      expectValidationEnvelope(await response.json());
    });

    it("returns 400 for invalid studentId path param", async () => {
      const linked = await bootstrapLinkedParentStudent(db);
      withSessionCookie(linked.parentSession);
      const spy = vi.spyOn(planService, "createFormalPlan");

      const response = await createFormalPlanRoute(
        new Request("http://localhost/api/family/students/not-a-uuid/formal-plans", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "Idempotency-Key": "route-create-bad-id",
          },
          body: JSON.stringify(DEFAULT_PLAN_BODY),
        }),
        { params: Promise.resolve({ studentId: "not-a-uuid" }) },
      );

      expect(response.status).toBe(400);
      expectValidationEnvelope(await response.json());
      expect(spy).not.toHaveBeenCalled();
    });

    it("maps active plan conflict to 409 (domain error)", async () => {
      const linked = await bootstrapLinkedParentStudent(db);
      withSessionCookie(linked.parentSession);

      expect((await createPlanViaRoute(linked.studentId, "route-create-active")).status).toBe(200);

      const second = await createPlanViaRoute(linked.studentId, "route-create-active-2");
      expect(second.status).toBe(409);
      expect(await second.json()).toMatchObject({ error: { code: "STATE_CONFLICT" } });
    });
  });

  describe("POST /formal-plans/maintain-horizon", () => {
    it("maintains horizon (success path)", async () => {
      const linked = await bootstrapLinkedParentStudent(db);
      withSessionCookie(linked.parentSession);

      expect(
        (await createPlanViaRoute(linked.studentId, "maintain-setup", todayFamilyDate())).status,
      ).toBe(200);

      const response = await maintainHorizonRoute(
        new Request(
          `http://localhost/api/family/students/${linked.studentId}/formal-plans/maintain-horizon`,
          {
            method: "POST",
            headers: { "Idempotency-Key": "route-maintain" },
          },
        ),
        { params: Promise.resolve({ studentId: linked.studentId }) },
      );

      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.maintainId).toBeTruthy();
      expect(typeof payload.itemsCreated).toBe("number");
    });

    it("returns 403 for unrelated student (auth)", async () => {
      const linked = await bootstrapLinkedParentStudent(db);
      const other = await bootstrapParentStudentRelationship(db);
      withSessionCookie(linked.parentSession);

      const response = await maintainHorizonRoute(
        new Request(
          `http://localhost/api/family/students/${other.studentId}/formal-plans/maintain-horizon`,
          { method: "POST", headers: { "Idempotency-Key": "route-maintain-forbidden" } },
        ),
        { params: Promise.resolve({ studentId: other.studentId }) },
      );

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
    });

    it("returns 400 for invalid studentId path param", async () => {
      const linked = await bootstrapLinkedParentStudent(db);
      withSessionCookie(linked.parentSession);
      const spy = vi.spyOn(maintainService, "maintainHorizon");

      const response = await maintainHorizonRoute(
        new Request(
          "http://localhost/api/family/students/not-a-uuid/formal-plans/maintain-horizon",
          { method: "POST", headers: { "Idempotency-Key": "route-maintain-bad-id" } },
        ),
        { params: Promise.resolve({ studentId: "not-a-uuid" }) },
      );

      expect(response.status).toBe(400);
      expectValidationEnvelope(await response.json());
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe("GET /formal-plans/current", () => {
    it("returns current plan (success path)", async () => {
      const linked = await bootstrapLinkedParentStudent(db);
      withSessionCookie(linked.parentSession);
      await createPlanViaRoute(linked.studentId, "current-setup", todayFamilyDate());

      const response = await getCurrentPlanRoute(
        new Request(
          `http://localhost/api/family/students/${linked.studentId}/formal-plans/current`,
        ),
        { params: Promise.resolve({ studentId: linked.studentId }) },
      );

      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.plan?.localTime).toBe("20:00");
    });

    it("returns 403 for unrelated student (auth)", async () => {
      const linked = await bootstrapLinkedParentStudent(db);
      const other = await bootstrapParentStudentRelationship(db);
      withSessionCookie(linked.parentSession);

      const response = await getCurrentPlanRoute(
        new Request(`http://localhost/api/family/students/${other.studentId}/formal-plans/current`),
        { params: Promise.resolve({ studentId: other.studentId }) },
      );

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
    });

    it("returns 400 for invalid studentId and skips query", async () => {
      const spy = vi.spyOn(scheduleQuery, "queryCurrentFormalPlan");
      const linked = await bootstrapLinkedParentStudent(db);
      withSessionCookie(linked.parentSession);

      const response = await getCurrentPlanRoute(
        new Request("http://localhost/api/family/students/not-a-uuid/formal-plans/current"),
        { params: Promise.resolve({ studentId: "not-a-uuid" }) },
      );

      expect(response.status).toBe(400);
      expectValidationEnvelope(await response.json());
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe("PATCH /formal-plans/[planId]", () => {
    it("edits formal plan (success path)", async () => {
      const linked = await bootstrapLinkedParentStudent(db);
      withSessionCookie(linked.parentSession);
      const created = await (await createPlanViaRoute(linked.studentId, "edit-setup")).json();

      const response = await editFormalPlanRoute(
        new Request(`http://localhost/api/formal-plans/${created.planId}`, {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "Idempotency-Key": "route-edit",
          },
          body: JSON.stringify({ title: "Updated Title" }),
        }),
        { params: Promise.resolve({ planId: created.planId }) },
      );

      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.planId).toBe(created.planId);
      expect(payload.versionId).toBeTruthy();
    });

    it("returns 403 for unrelated parent (auth)", async () => {
      const owner = await bootstrapLinkedParentStudent(db);
      const other = await bootstrapLinkedParentStudent(db);
      withSessionCookie(owner.parentSession);
      const created = await (
        await createPlanViaRoute(owner.studentId, "edit-forbidden-setup")
      ).json();

      withSessionCookie(other.parentSession);
      const response = await editFormalPlanRoute(
        new Request(`http://localhost/api/formal-plans/${created.planId}`, {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "Idempotency-Key": "route-edit-forbidden",
          },
          body: JSON.stringify({ title: "Hijack" }),
        }),
        { params: Promise.resolve({ planId: created.planId }) },
      );

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
    });

    it("returns 400 for invalid body (DTO validation)", async () => {
      const linked = await bootstrapLinkedParentStudent(db);
      withSessionCookie(linked.parentSession);
      const created = await (
        await createPlanViaRoute(linked.studentId, "edit-invalid-setup")
      ).json();

      const response = await editFormalPlanRoute(
        new Request(`http://localhost/api/formal-plans/${created.planId}`, {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "Idempotency-Key": "route-edit-invalid",
          },
          body: JSON.stringify({ localTime: "invalid" }),
        }),
        { params: Promise.resolve({ planId: created.planId }) },
      );

      expect(response.status).toBe(400);
      expectValidationEnvelope(await response.json());
    });

    it("returns 404 for unknown planId (domain error)", async () => {
      const linked = await bootstrapLinkedParentStudent(db);
      withSessionCookie(linked.parentSession);
      const missingPlanId = "00000000-0000-4000-8000-000000009999";

      const response = await editFormalPlanRoute(
        new Request(`http://localhost/api/formal-plans/${missingPlanId}`, {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "Idempotency-Key": "route-edit-not-found",
          },
          body: JSON.stringify({ title: "Ghost" }),
        }),
        { params: Promise.resolve({ planId: missingPlanId }) },
      );

      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
    });

    it("returns 400 for invalid planId path param", async () => {
      const linked = await bootstrapLinkedParentStudent(db);
      withSessionCookie(linked.parentSession);
      const spy = vi.spyOn(planService, "editFormalPlan");

      const response = await editFormalPlanRoute(
        new Request("http://localhost/api/formal-plans/not-a-uuid", {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "Idempotency-Key": "route-edit-bad-id",
          },
          body: JSON.stringify({ title: "Bad" }),
        }),
        { params: Promise.resolve({ planId: "not-a-uuid" }) },
      );

      expect(response.status).toBe(400);
      expectValidationEnvelope(await response.json());
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe("POST /formal-plans/[planId]/deactivate", () => {
    it("deactivates formal plan (success path)", async () => {
      const linked = await bootstrapLinkedParentStudent(db);
      withSessionCookie(linked.parentSession);
      const created = await (await createPlanViaRoute(linked.studentId, "deactivate-setup")).json();

      const response = await deactivateFormalPlanRoute(
        new Request(`http://localhost/api/formal-plans/${created.planId}/deactivate`, {
          method: "POST",
          headers: { "Idempotency-Key": "route-deactivate" },
        }),
        { params: Promise.resolve({ planId: created.planId }) },
      );

      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.planId).toBe(created.planId);
      expect(payload.status).toBe("inactive");
    });

    it("returns 403 for unrelated parent (auth)", async () => {
      const owner = await bootstrapLinkedParentStudent(db);
      const other = await bootstrapLinkedParentStudent(db);
      withSessionCookie(owner.parentSession);
      const created = await (
        await createPlanViaRoute(owner.studentId, "deactivate-forbidden-setup")
      ).json();

      withSessionCookie(other.parentSession);
      const response = await deactivateFormalPlanRoute(
        new Request(`http://localhost/api/formal-plans/${created.planId}/deactivate`, {
          method: "POST",
          headers: { "Idempotency-Key": "route-deactivate-forbidden" },
        }),
        { params: Promise.resolve({ planId: created.planId }) },
      );

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
    });

    it("returns 404 for unknown planId (domain error)", async () => {
      const linked = await bootstrapLinkedParentStudent(db);
      withSessionCookie(linked.parentSession);
      const missingPlanId = "00000000-0000-4000-8000-000000009998";

      const response = await deactivateFormalPlanRoute(
        new Request(`http://localhost/api/formal-plans/${missingPlanId}/deactivate`, {
          method: "POST",
          headers: { "Idempotency-Key": "route-deactivate-not-found" },
        }),
        { params: Promise.resolve({ planId: missingPlanId }) },
      );

      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
    });

    it("returns 400 for invalid planId path param", async () => {
      const linked = await bootstrapLinkedParentStudent(db);
      withSessionCookie(linked.parentSession);
      const spy = vi.spyOn(planService, "deactivateFormalPlan");

      const response = await deactivateFormalPlanRoute(
        new Request("http://localhost/api/formal-plans/not-a-uuid/deactivate", {
          method: "POST",
          headers: { "Idempotency-Key": "route-deactivate-bad-id" },
        }),
        { params: Promise.resolve({ planId: "not-a-uuid" }) },
      );

      expect(response.status).toBe(400);
      expectValidationEnvelope(await response.json());
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe("GET /schedule-items", () => {
    it("lists schedule items (success path)", async () => {
      const linked = await bootstrapLinkedParentStudent(db);
      withSessionCookie(linked.parentSession);
      await createPlanViaRoute(linked.studentId, "items-setup", todayFamilyDate());

      const response = await getScheduleItemsRoute(
        new Request(
          `http://localhost/api/family/students/${linked.studentId}/schedule-items?from=${todayFamilyDate()}&to=${todayFamilyDate()}`,
        ),
        { params: Promise.resolve({ studentId: linked.studentId }) },
      );

      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.items.length).toBeGreaterThan(0);
    });

    it("returns 403 for unrelated student (auth)", async () => {
      const linked = await bootstrapLinkedParentStudent(db);
      const other = await bootstrapParentStudentRelationship(db);
      withSessionCookie(linked.studentSession);

      const response = await getScheduleItemsRoute(
        new Request(
          `http://localhost/api/family/students/${other.studentId}/schedule-items?from=${todayFamilyDate()}&to=${todayFamilyDate()}`,
        ),
        { params: Promise.resolve({ studentId: other.studentId }) },
      );

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
    });

    it("returns 400 for invalid query (DTO validation)", async () => {
      const linked = await bootstrapLinkedParentStudent(db);
      withSessionCookie(linked.parentSession);

      const response = await getScheduleItemsRoute(
        new Request(
          `http://localhost/api/family/students/${linked.studentId}/schedule-items?from=bad&to=bad`,
        ),
        { params: Promise.resolve({ studentId: linked.studentId }) },
      );

      expect(response.status).toBe(400);
      expectValidationEnvelope(await response.json());
    });

    it("returns 400 for invalid studentId path param", async () => {
      const linked = await bootstrapLinkedParentStudent(db);
      withSessionCookie(linked.parentSession);
      const spy = vi.spyOn(scheduleQuery, "queryScheduleItems");

      const response = await getScheduleItemsRoute(
        new Request(
          `http://localhost/api/family/students/not-a-uuid/schedule-items?from=${todayFamilyDate()}&to=${todayFamilyDate()}`,
        ),
        { params: Promise.resolve({ studentId: "not-a-uuid" }) },
      );

      expect(response.status).toBe(400);
      expectValidationEnvelope(await response.json());
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe("POST /schedule-items/[itemId]/complete", () => {
    async function setupCompleteFixture() {
      const linked = await bootstrapLinkedParentStudent(db);
      withSessionCookie(linked.parentSession);
      const created = await (
        await createPlanViaRoute(linked.studentId, "complete-setup", todayFamilyDate())
      ).json();

      await enablePointRuleRoute(
        new Request(`http://localhost/api/family/students/${linked.studentId}/point-rules`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "Idempotency-Key": "complete-rule-setup",
          },
          body: JSON.stringify({ templateId: "schedule_system_complete_v1" }),
        }),
        { params: Promise.resolve({ studentId: linked.studentId }) },
      );

      const items = await db.execute(sql`
        SELECT id FROM schedule_items
        WHERE plan_id = ${created.planId}::uuid
        ORDER BY family_date ASC
        LIMIT 1
      `);
      const itemId = (items[0] as { id: string }).id;
      return { linked, itemId };
    }

    it("completes schedule item (success path)", async () => {
      const { linked, itemId } = await setupCompleteFixture();
      withSessionCookie(linked.studentSession);

      const response = await completeScheduleRoute(
        new Request(`http://localhost/api/schedule-items/${itemId}/complete`, {
          method: "POST",
          headers: { "Idempotency-Key": "route-complete-item" },
        }),
        { params: Promise.resolve({ itemId }) },
      );

      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.ledgerEntryId).toBeTruthy();
    });

    it("returns 403 when parent attempts complete (auth)", async () => {
      const { linked, itemId } = await setupCompleteFixture();
      withSessionCookie(linked.parentSession);

      const response = await completeScheduleRoute(
        new Request(`http://localhost/api/schedule-items/${itemId}/complete`, {
          method: "POST",
          headers: { "Idempotency-Key": "route-parent-complete" },
        }),
        { params: Promise.resolve({ itemId }) },
      );

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
    });

    it("returns 400 for invalid itemId path param", async () => {
      const linked = await bootstrapLinkedParentStudent(db);
      withSessionCookie(linked.studentSession);
      const spy = vi.spyOn(completeService, "completeScheduleItem");

      const response = await completeScheduleRoute(
        new Request("http://localhost/api/schedule-items/not-a-uuid/complete", {
          method: "POST",
          headers: { "Idempotency-Key": "route-complete-bad-id" },
        }),
        { params: Promise.resolve({ itemId: "not-a-uuid" }) },
      );

      expect(response.status).toBe(400);
      expectValidationEnvelope(await response.json());
      expect(spy).not.toHaveBeenCalled();
    });

    it("returns 404 for unknown itemId (domain error)", async () => {
      const linked = await bootstrapLinkedParentStudent(db);
      withSessionCookie(linked.studentSession);
      const missingItemId = "00000000-0000-4000-8000-000000009997";

      const response = await completeScheduleRoute(
        new Request(`http://localhost/api/schedule-items/${missingItemId}/complete`, {
          method: "POST",
          headers: { "Idempotency-Key": "route-complete-not-found" },
        }),
        { params: Promise.resolve({ itemId: missingItemId }) },
      );

      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
    });
  });

  describe("POST /schedule-items/[itemId]/skip", () => {
    async function setupSkipFixture() {
      const linked = await bootstrapLinkedParentStudent(db);
      withSessionCookie(linked.parentSession);
      const created = await (
        await createPlanViaRoute(linked.studentId, "skip-setup", todayFamilyDate())
      ).json();
      const items = await db.execute(sql`
        SELECT id FROM schedule_items
        WHERE plan_id = ${created.planId}::uuid
        ORDER BY family_date ASC
        LIMIT 1
      `);
      return { linked, itemId: (items[0] as { id: string }).id };
    }

    it("skips schedule item (success path)", async () => {
      const { linked, itemId } = await setupSkipFixture();
      withSessionCookie(linked.parentSession);

      const response = await skipScheduleRoute(
        new Request(`http://localhost/api/schedule-items/${itemId}/skip`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "Idempotency-Key": "route-skip",
          },
          body: JSON.stringify({ reason: "travel" }),
        }),
        { params: Promise.resolve({ itemId }) },
      );

      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.scheduleItemId).toBe(itemId);
      expect(payload.eventId).toBeTruthy();
    });

    it("returns 403 for unrelated student (auth)", async () => {
      const { itemId } = await setupSkipFixture();
      const other = await bootstrapLinkedParentStudent(db);
      withSessionCookie(other.studentSession);

      const response = await skipScheduleRoute(
        new Request(`http://localhost/api/schedule-items/${itemId}/skip`, {
          method: "POST",
          headers: { "Idempotency-Key": "route-skip-forbidden" },
        }),
        { params: Promise.resolve({ itemId }) },
      );

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
    });

    it("returns 400 for invalid itemId path param", async () => {
      const linked = await bootstrapLinkedParentStudent(db);
      withSessionCookie(linked.parentSession);
      const spy = vi.spyOn(skipService, "skipScheduleItem");

      const response = await skipScheduleRoute(
        new Request("http://localhost/api/schedule-items/not-a-uuid/skip", {
          method: "POST",
          headers: { "Idempotency-Key": "route-skip-bad-id" },
        }),
        { params: Promise.resolve({ itemId: "not-a-uuid" }) },
      );

      expect(response.status).toBe(400);
      expectValidationEnvelope(await response.json());
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe("POST /point-rules", () => {
    it("enables point rule (success path)", async () => {
      const linked = await bootstrapLinkedParentStudent(db);
      withSessionCookie(linked.parentSession);

      const response = await enablePointRuleRoute(
        new Request(`http://localhost/api/family/students/${linked.studentId}/point-rules`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "Idempotency-Key": "route-enable-rule",
          },
          body: JSON.stringify({ templateId: "schedule_system_complete_v1" }),
        }),
        { params: Promise.resolve({ studentId: linked.studentId }) },
      );

      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.ruleId).toBeTruthy();
      expect(payload.ruleVersionId).toBeTruthy();
    });

    it("returns 403 for unrelated student (auth)", async () => {
      const linked = await bootstrapLinkedParentStudent(db);
      const other = await bootstrapParentStudentRelationship(db);
      withSessionCookie(linked.parentSession);

      const response = await enablePointRuleRoute(
        new Request(`http://localhost/api/family/students/${other.studentId}/point-rules`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "Idempotency-Key": "route-rule-forbidden",
          },
          body: JSON.stringify({ templateId: "schedule_system_complete_v1" }),
        }),
        { params: Promise.resolve({ studentId: other.studentId }) },
      );

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
    });

    it("returns 400 for invalid body (DTO validation)", async () => {
      const linked = await bootstrapLinkedParentStudent(db);
      withSessionCookie(linked.parentSession);

      const response = await enablePointRuleRoute(
        new Request(`http://localhost/api/family/students/${linked.studentId}/point-rules`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "Idempotency-Key": "route-rule-invalid",
          },
          body: JSON.stringify({ templateId: "unknown_template" }),
        }),
        { params: Promise.resolve({ studentId: linked.studentId }) },
      );

      expect(response.status).toBe(400);
      expectValidationEnvelope(await response.json());
    });

    it("maps duplicate enable to 409 (domain error)", async () => {
      const linked = await bootstrapLinkedParentStudent(db);
      withSessionCookie(linked.parentSession);

      const first = await enablePointRuleRoute(
        new Request(`http://localhost/api/family/students/${linked.studentId}/point-rules`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "Idempotency-Key": "route-rule-dup-1",
          },
          body: JSON.stringify({ templateId: "schedule_system_complete_v1" }),
        }),
        { params: Promise.resolve({ studentId: linked.studentId }) },
      );
      expect(first.status).toBe(200);

      const second = await enablePointRuleRoute(
        new Request(`http://localhost/api/family/students/${linked.studentId}/point-rules`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "Idempotency-Key": "route-rule-dup-2",
          },
          body: JSON.stringify({ templateId: "schedule_system_complete_v1" }),
        }),
        { params: Promise.resolve({ studentId: linked.studentId }) },
      );

      expect(second.status).toBe(409);
      expect(await second.json()).toMatchObject({ error: { code: "STATE_CONFLICT" } });
    });

    it("returns 400 for invalid studentId path param", async () => {
      const linked = await bootstrapLinkedParentStudent(db);
      withSessionCookie(linked.parentSession);
      const spy = vi.spyOn(pointRuleService, "enablePointRule");

      const response = await enablePointRuleRoute(
        new Request("http://localhost/api/family/students/not-a-uuid/point-rules", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "Idempotency-Key": "route-rule-bad-id",
          },
          body: JSON.stringify({ templateId: "schedule_system_complete_v1" }),
        }),
        { params: Promise.resolve({ studentId: "not-a-uuid" }) },
      );

      expect(response.status).toBe(400);
      expectValidationEnvelope(await response.json());
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe("GET /points/balance", () => {
    it("returns balance after completion (success path)", async () => {
      const linked = await bootstrapLinkedParentStudent(db);
      withSessionCookie(linked.parentSession);
      const created = await (
        await createPlanViaRoute(linked.studentId, "balance-setup", todayFamilyDate())
      ).json();

      await enablePointRuleRoute(
        new Request(`http://localhost/api/family/students/${linked.studentId}/point-rules`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "Idempotency-Key": "balance-rule-setup",
          },
          body: JSON.stringify({ templateId: "schedule_system_complete_v1" }),
        }),
        { params: Promise.resolve({ studentId: linked.studentId }) },
      );

      const items = await db.execute(sql`
        SELECT id FROM schedule_items WHERE plan_id = ${created.planId}::uuid LIMIT 1
      `);
      const itemId = (items[0] as { id: string }).id;

      withSessionCookie(linked.studentSession);
      await completeScheduleRoute(
        new Request(`http://localhost/api/schedule-items/${itemId}/complete`, {
          method: "POST",
          headers: { "Idempotency-Key": "balance-complete" },
        }),
        { params: Promise.resolve({ itemId }) },
      );

      withSessionCookie(linked.parentSession);
      const response = await getPointsBalanceRoute(
        new Request(`http://localhost/api/family/students/${linked.studentId}/points/balance`),
        { params: Promise.resolve({ studentId: linked.studentId }) },
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ balance: 10 });
    });

    it("returns 403 for unrelated student (auth)", async () => {
      const linked = await bootstrapLinkedParentStudent(db);
      const other = await bootstrapParentStudentRelationship(db);
      withSessionCookie(linked.parentSession);

      const response = await getPointsBalanceRoute(
        new Request(`http://localhost/api/family/students/${other.studentId}/points/balance`),
        { params: Promise.resolve({ studentId: other.studentId }) },
      );

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
    });

    it("returns 400 for invalid studentId and skips query", async () => {
      const spy = vi.spyOn(ledgerService, "queryPointsBalance");
      const linked = await bootstrapLinkedParentStudent(db);
      withSessionCookie(linked.parentSession);

      const response = await getPointsBalanceRoute(
        new Request("http://localhost/api/family/students/not-a-uuid/points/balance"),
        { params: Promise.resolve({ studentId: "not-a-uuid" }) },
      );

      expect(response.status).toBe(400);
      expectValidationEnvelope(await response.json());
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe("GET /points/ledger", () => {
    it("returns ledger entries (success path)", async () => {
      const linked = await bootstrapLinkedParentStudent(db);
      withSessionCookie(linked.parentSession);
      const created = await (
        await createPlanViaRoute(linked.studentId, "ledger-setup", todayFamilyDate())
      ).json();

      await enablePointRuleRoute(
        new Request(`http://localhost/api/family/students/${linked.studentId}/point-rules`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "Idempotency-Key": "ledger-rule-setup",
          },
          body: JSON.stringify({ templateId: "schedule_system_complete_v1" }),
        }),
        { params: Promise.resolve({ studentId: linked.studentId }) },
      );

      const items = await db.execute(sql`
        SELECT id FROM schedule_items WHERE plan_id = ${created.planId}::uuid LIMIT 1
      `);
      const itemId = (items[0] as { id: string }).id;

      withSessionCookie(linked.studentSession);
      await completeScheduleRoute(
        new Request(`http://localhost/api/schedule-items/${itemId}/complete`, {
          method: "POST",
          headers: { "Idempotency-Key": "ledger-complete" },
        }),
        { params: Promise.resolve({ itemId }) },
      );

      withSessionCookie(linked.parentSession);
      const response = await getPointsLedgerRoute(
        new Request(
          `http://localhost/api/family/students/${linked.studentId}/points/ledger?limit=10`,
        ),
        { params: Promise.resolve({ studentId: linked.studentId }) },
      );

      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.entries.length).toBe(1);
      expect(payload.entries[0].amount).toBe(10);
    });

    it("returns 403 for unrelated student (auth)", async () => {
      const linked = await bootstrapLinkedParentStudent(db);
      const other = await bootstrapParentStudentRelationship(db);
      withSessionCookie(linked.studentSession);

      const response = await getPointsLedgerRoute(
        new Request(`http://localhost/api/family/students/${other.studentId}/points/ledger`),
        { params: Promise.resolve({ studentId: other.studentId }) },
      );

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
    });

    it("returns 400 for invalid limit query (DTO validation)", async () => {
      const linked = await bootstrapLinkedParentStudent(db);
      withSessionCookie(linked.parentSession);

      const response = await getPointsLedgerRoute(
        new Request(
          `http://localhost/api/family/students/${linked.studentId}/points/ledger?limit=0`,
        ),
        { params: Promise.resolve({ studentId: linked.studentId }) },
      );

      expect(response.status).toBe(400);
      expectValidationEnvelope(await response.json());
    });

    it("returns 400 for invalid studentId and skips query", async () => {
      const spy = vi.spyOn(ledgerService, "queryPointsLedger");
      const linked = await bootstrapLinkedParentStudent(db);
      withSessionCookie(linked.parentSession);

      const response = await getPointsLedgerRoute(
        new Request("http://localhost/api/family/students/not-a-uuid/points/ledger"),
        { params: Promise.resolve({ studentId: "not-a-uuid" }) },
      );

      expect(response.status).toBe(400);
      expectValidationEnvelope(await response.json());
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe("GET read-only invariant (NF-4/F5)", () => {
    it("GET current/schedule-items/balance/ledger do not trigger maintain writes", async () => {
      const linked = await bootstrapLinkedParentStudent(db);
      withSessionCookie(linked.parentSession);
      await createPlanViaRoute(linked.studentId, "readonly-setup", todayFamilyDate());

      const beforeCounts = await db.execute(sql`
        SELECT
          (SELECT count(*)::int FROM schedule_horizon_maintains) AS maintains,
          (SELECT count(*)::int FROM schedule_items WHERE status = 'expired') AS expired
      `);
      const before = beforeCounts[0] as { maintains: number; expired: number };

      await getCurrentPlanRoute(
        new Request(
          `http://localhost/api/family/students/${linked.studentId}/formal-plans/current`,
        ),
        { params: Promise.resolve({ studentId: linked.studentId }) },
      );
      await getScheduleItemsRoute(
        new Request(
          `http://localhost/api/family/students/${linked.studentId}/schedule-items?from=${todayFamilyDate()}&to=${todayFamilyDate()}`,
        ),
        { params: Promise.resolve({ studentId: linked.studentId }) },
      );
      await getPointsBalanceRoute(
        new Request(`http://localhost/api/family/students/${linked.studentId}/points/balance`),
        { params: Promise.resolve({ studentId: linked.studentId }) },
      );
      await getPointsLedgerRoute(
        new Request(`http://localhost/api/family/students/${linked.studentId}/points/ledger`),
        { params: Promise.resolve({ studentId: linked.studentId }) },
      );

      const afterCounts = await db.execute(sql`
        SELECT
          (SELECT count(*)::int FROM schedule_horizon_maintains) AS maintains,
          (SELECT count(*)::int FROM schedule_items WHERE status = 'expired') AS expired
      `);
      const after = afterCounts[0] as { maintains: number; expired: number };

      expect(after).toEqual(before);
    });
  });
});
