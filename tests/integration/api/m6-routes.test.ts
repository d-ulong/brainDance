import { config } from "dotenv";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import "./helpers/auth-mock";
import { clearMockSessionCookie } from "./helpers/auth-mock";
import { bootstrapLinkedParentStudent, withSessionCookie } from "./helpers/session";
import {
  GET as getCatalogRoute,
  POST as createCatalogRoute,
} from "@/app/api/family/students/[studentId]/redemption-catalog/route";
import { PATCH as updateCatalogRoute } from "@/app/api/family/students/[studentId]/redemption-catalog/[itemId]/route";
import {
  GET as listRedemptionsRoute,
  POST as createRedemptionRoute,
} from "@/app/api/family/students/[studentId]/redemptions/route";
import { POST as approveRedemptionRoute } from "@/app/api/family/students/[studentId]/redemptions/[redemptionId]/approve/route";
import { POST as rejectRedemptionRoute } from "@/app/api/family/students/[studentId]/redemptions/[redemptionId]/reject/route";
import { POST as cancelRedemptionRoute } from "@/app/api/family/students/[studentId]/redemptions/[redemptionId]/cancel/route";
import { login } from "@/modules/identity/login.service";
import {
  acceptParentForStudent,
  bootstrapVerifiedParentWithInvite,
  seedStudentUser,
} from "../../helpers/family-access";
import { closeTestDb, getTestDb, migrateTestDb, resetIdentityTables } from "../../helpers/db";
import {
  bootstrapCatalogItem,
  resetRedemptionTables,
  seedStudentBalance,
} from "../../helpers/redemption";
import { bootstrapParentStudentRelationship, resetScheduleTables } from "../../helpers/schedule";
import { updateCatalogItem } from "@/modules/redemption/catalog.service";
import { createRedemptionRequest } from "@/modules/redemption/redemption.service";

config({ path: ".env.local" });
config({ path: ".env" });

const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);

function jsonRequest(url: string, init: RequestInit & { idempotencyKey?: string } = {}): Request {
  const headers = new Headers(init.headers);
  if (init.idempotencyKey) {
    headers.set("Idempotency-Key", init.idempotencyKey);
  }
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return new Request(url, { ...init, headers });
}

describe.skipIf(!hasDb)("m6 api routes", () => {
  const db = getTestDb();

  beforeAll(async () => {
    process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";
    await migrateTestDb();
  });

  beforeEach(async () => {
    clearMockSessionCookie();
    await resetIdentityTables(db);
    await resetScheduleTables(db);
    await resetRedemptionTables(db);
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("requires Idempotency-Key on write routes", async () => {
    const { studentId } = await bootstrapParentStudentRelationship(db);
    const response = await createRedemptionRoute(
      jsonRequest(`http://localhost/api/family/students/${studentId}/redemptions`, {
        method: "POST",
        body: JSON.stringify({ catalogItemId: crypto.randomUUID() }),
      }),
      { params: Promise.resolve({ studentId }) },
    );
    expect(response.status).toBe(400);
  });

  it("returns 403 when parent accesses another student catalog write", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const email = `parent_${suffix}@test.local`;
    const { parentId } = await bootstrapVerifiedParentWithInvite(db, email);
    const linked = await bootstrapParentStudentRelationship(db);
    const outsider = await seedStudentUser(db, {
      username: `outsider_${suffix}`,
      password: "StudentPass123!Student",
    });

    const session = await login(db, {
      identifier: email,
      password: "ParentPass123!Parent",
      idempotencyKey: `login-${suffix}`,
    });
    withSessionCookie(session);

    const response = await createCatalogRoute(
      jsonRequest(`http://localhost/api/family/students/${outsider.studentId}/redemption-catalog`, {
        method: "POST",
        idempotencyKey: "create-catalog",
        body: JSON.stringify({ title: "X", cost: 5 }),
      }),
      { params: Promise.resolve({ studentId: outsider.studentId }) },
    );

    expect(response.status).toBe(403);
    void parentId;
    void linked;
  });

  it("student and parent can read catalog; student can request and parent approve", async () => {
    const { parentId, studentId, suffix } = await bootstrapParentStudentRelationship(db);
    await seedStudentBalance(db, studentId, 50);

    const { item } = await bootstrapCatalogItem(db, { parentId, studentId });

    const parentSession = await login(db, {
      identifier: `parent_${suffix}@test.local`,
      password: "ParentPass123!Parent",
      idempotencyKey: `login-parent-${suffix}`,
    });
    withSessionCookie(parentSession);

    const parentRead = await getCatalogRoute(new Request("http://localhost/"), {
      params: Promise.resolve({ studentId }),
    });
    expect(parentRead.status).toBe(200);

    const studentLogin = await login(db, {
      identifier: `student_${suffix}`,
      password: "StudentPass123!Student",
      idempotencyKey: `login-student-${suffix}`,
    });
    withSessionCookie(studentLogin);

    const createResp = await createRedemptionRoute(
      jsonRequest(`http://localhost/api/family/students/${studentId}/redemptions`, {
        method: "POST",
        idempotencyKey: "create-redemption",
        body: JSON.stringify({ catalogItemId: item.id }),
      }),
      { params: Promise.resolve({ studentId }) },
    );
    expect(createResp.status).toBe(200);
    const created = (await createResp.json()) as { redemption: { id: string; status: string } };
    expect(created.redemption.status).toBe("pending");

    withSessionCookie(parentSession);
    const approveResp = await approveRedemptionRoute(
      jsonRequest(
        `http://localhost/api/family/students/${studentId}/redemptions/${created.redemption.id}/approve`,
        { method: "POST", idempotencyKey: "approve-route" },
      ),
      { params: Promise.resolve({ studentId, redemptionId: created.redemption.id }) },
    );
    expect(approveResp.status).toBe(200);
  });

  it("ended parent cannot approve redemption", async () => {
    const { parentId, studentId, suffix } = await bootstrapParentStudentRelationship(db);
    await seedStudentBalance(db, studentId, 50);
    const { item } = await bootstrapCatalogItem(db, { parentId, studentId });

    const redemption = await createRedemptionRequest(db, {
      studentId,
      actorId: studentId,
      catalogItemId: item.id,
      idempotencyKey: "service-req",
    });

    const { endRelationship } = await import("@/modules/family-access/end-relationship.service");
    const { relationships } = await import("@/db/schema");
    const [rel] = await db
      .select()
      .from(relationships)
      .where(and(eq(relationships.parentId, parentId), eq(relationships.studentId, studentId)));

    await endRelationship(db, {
      actorId: parentId,
      relationshipId: rel!.id,
      idempotencyKey: "end-for-route",
    });

    const session = await login(db, {
      identifier: `parent_${suffix}@test.local`,
      password: "ParentPass123!Parent",
      idempotencyKey: `login-ended-${suffix}`,
    });
    withSessionCookie(session);

    const approveResp = await approveRedemptionRoute(
      jsonRequest(
        `http://localhost/api/family/students/${studentId}/redemptions/${redemption.redemption.id}/approve`,
        { method: "POST", idempotencyKey: "approve-ended" },
      ),
      { params: Promise.resolve({ studentId, redemptionId: redemption.redemption.id }) },
    );
    expect(approveResp.status).toBe(403);
  });

  it("P1-F03: student cannot read inactive catalog even with activeOnly=false query", async () => {
    const linked = await bootstrapLinkedParentStudent(db);
    const { item } = await bootstrapCatalogItem(db, {
      parentId: linked.parentId,
      studentId: linked.studentId,
    });

    await updateCatalogItem(db, {
      parentId: linked.parentId,
      studentId: linked.studentId,
      itemId: item.id,
      idempotencyKey: "deactivate-catalog",
      body: { active: false },
    });

    withSessionCookie(linked.studentSession);
    const studentRead = await getCatalogRoute(new Request("http://localhost/?activeOnly=false"), {
      params: Promise.resolve({ studentId: linked.studentId }),
    });
    expect(studentRead.status).toBe(200);
    const studentBody = (await studentRead.json()) as { items: Array<{ id: string }> };
    expect(studentBody.items).toHaveLength(0);

    withSessionCookie(linked.parentSession);
    const parentRead = await getCatalogRoute(new Request("http://localhost/"), {
      params: Promise.resolve({ studentId: linked.studentId }),
    });
    expect(parentRead.status).toBe(200);
    const parentBody = (await parentRead.json()) as {
      items: Array<{ id: string; active: boolean }>;
    };
    expect(parentBody.items.some((entry) => entry.id === item.id && entry.active === false)).toBe(
      true,
    );
  });

  it("route matrix: creating parent can create and update own catalog", async () => {
    const linked = await bootstrapLinkedParentStudent(db);
    withSessionCookie(linked.parentSession);

    const createResp = await createCatalogRoute(
      jsonRequest(`http://localhost/api/family/students/${linked.studentId}/redemption-catalog`, {
        method: "POST",
        idempotencyKey: "route-create-catalog",
        body: JSON.stringify({ title: "Route Reward", cost: 8 }),
      }),
      { params: Promise.resolve({ studentId: linked.studentId }) },
    );
    expect(createResp.status).toBe(200);
    const created = (await createResp.json()) as { item: { id: string } };

    const updateResp = await updateCatalogRoute(
      jsonRequest(
        `http://localhost/api/family/students/${linked.studentId}/redemption-catalog/${created.item.id}`,
        {
          method: "PATCH",
          idempotencyKey: "route-update-catalog",
          body: JSON.stringify({ title: "Updated Reward" }),
        },
      ),
      { params: Promise.resolve({ studentId: linked.studentId, itemId: created.item.id }) },
    );
    expect(updateResp.status).toBe(200);
  });

  it("route matrix: other valid parent cannot update creator catalog", async () => {
    const linked = await bootstrapLinkedParentStudent(db);
    const { item } = await bootstrapCatalogItem(db, {
      parentId: linked.parentId,
      studentId: linked.studentId,
    });

    const suffix = crypto.randomUUID().slice(0, 8);
    const { parentId: otherParentId } = await bootstrapVerifiedParentWithInvite(
      db,
      `other_${suffix}@test.local`,
    );
    await acceptParentForStudent(db, {
      parentId: otherParentId,
      studentId: linked.studentId,
      idempotencySuffix: suffix,
    });

    const otherSession = await login(db, {
      identifier: `other_${suffix}@test.local`,
      password: "ParentPass123!Parent",
      idempotencyKey: `login-other-${suffix}`,
    });
    withSessionCookie(otherSession);

    const updateResp = await updateCatalogRoute(
      jsonRequest(
        `http://localhost/api/family/students/${linked.studentId}/redemption-catalog/${item.id}`,
        {
          method: "PATCH",
          idempotencyKey: "other-parent-update",
          body: JSON.stringify({ title: "Hacked" }),
        },
      ),
      { params: Promise.resolve({ studentId: linked.studentId, itemId: item.id }) },
    );
    expect(updateResp.status).toBe(403);
  });

  it("route matrix: student create/cancel and parent reject with validation errors", async () => {
    const linked = await bootstrapLinkedParentStudent(db);
    const { item } = await bootstrapCatalogItem(db, {
      parentId: linked.parentId,
      studentId: linked.studentId,
    });

    withSessionCookie(linked.studentSession);
    const invalidCreate = await createRedemptionRoute(
      jsonRequest(`http://localhost/api/family/students/${linked.studentId}/redemptions`, {
        method: "POST",
        idempotencyKey: "invalid-create",
        body: JSON.stringify({ catalogItemId: "not-a-uuid" }),
      }),
      { params: Promise.resolve({ studentId: linked.studentId }) },
    );
    expect(invalidCreate.status).toBe(400);

    const unknownCreate = await createRedemptionRoute(
      jsonRequest(`http://localhost/api/family/students/${linked.studentId}/redemptions`, {
        method: "POST",
        idempotencyKey: "unknown-create",
        body: JSON.stringify({ catalogItemId: crypto.randomUUID() }),
      }),
      { params: Promise.resolve({ studentId: linked.studentId }) },
    );
    expect(unknownCreate.status).toBe(404);

    const created = await createRedemptionRequest(db, {
      studentId: linked.studentId,
      actorId: linked.studentId,
      catalogItemId: item.id,
      idempotencyKey: "route-reject-req",
    });

    withSessionCookie(linked.parentSession);
    const invalidReject = await rejectRedemptionRoute(
      jsonRequest(
        `http://localhost/api/family/students/${linked.studentId}/redemptions/${created.redemption.id}/reject`,
        {
          method: "POST",
          idempotencyKey: "invalid-reject",
          body: JSON.stringify({ reason: "" }),
        },
      ),
      {
        params: Promise.resolve({
          studentId: linked.studentId,
          redemptionId: created.redemption.id,
        }),
      },
    );
    expect(invalidReject.status).toBe(400);

    withSessionCookie(linked.studentSession);
    const cancelResp = await cancelRedemptionRoute(
      jsonRequest(
        `http://localhost/api/family/students/${linked.studentId}/redemptions/${created.redemption.id}/cancel`,
        { method: "POST", idempotencyKey: "route-cancel" },
      ),
      {
        params: Promise.resolve({
          studentId: linked.studentId,
          redemptionId: created.redemption.id,
        }),
      },
    );
    expect(cancelResp.status).toBe(200);
  });

  it("route matrix: cross-student redemption write returns forbidden", async () => {
    const linked = await bootstrapLinkedParentStudent(db);
    const outsider = await seedStudentUser(db, {
      username: `outsider_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });
    const { item } = await bootstrapCatalogItem(db, {
      parentId: linked.parentId,
      studentId: linked.studentId,
    });

    withSessionCookie(linked.studentSession);
    const crossStudent = await createRedemptionRoute(
      jsonRequest(`http://localhost/api/family/students/${outsider.studentId}/redemptions`, {
        method: "POST",
        idempotencyKey: "cross-student",
        body: JSON.stringify({ catalogItemId: item.id }),
      }),
      { params: Promise.resolve({ studentId: outsider.studentId }) },
    );
    expect(crossStudent.status).toBe(403);
  });

  it("route matrix: parent cannot cancel student redemption; student cannot approve", async () => {
    const linked = await bootstrapLinkedParentStudent(db);
    await seedStudentBalance(db, linked.studentId, 50);
    const { item } = await bootstrapCatalogItem(db, {
      parentId: linked.parentId,
      studentId: linked.studentId,
    });

    withSessionCookie(linked.studentSession);
    const createResp = await createRedemptionRoute(
      jsonRequest(`http://localhost/api/family/students/${linked.studentId}/redemptions`, {
        method: "POST",
        idempotencyKey: "role-matrix-req",
        body: JSON.stringify({ catalogItemId: item.id }),
      }),
      { params: Promise.resolve({ studentId: linked.studentId }) },
    );
    const created = (await createResp.json()) as { redemption: { id: string } };

    withSessionCookie(linked.parentSession);
    const parentCancel = await cancelRedemptionRoute(
      jsonRequest(
        `http://localhost/api/family/students/${linked.studentId}/redemptions/${created.redemption.id}/cancel`,
        { method: "POST", idempotencyKey: "parent-cancel" },
      ),
      {
        params: Promise.resolve({
          studentId: linked.studentId,
          redemptionId: created.redemption.id,
        }),
      },
    );
    expect(parentCancel.status).toBe(403);

    withSessionCookie(linked.studentSession);
    const studentApprove = await approveRedemptionRoute(
      jsonRequest(
        `http://localhost/api/family/students/${linked.studentId}/redemptions/${created.redemption.id}/approve`,
        { method: "POST", idempotencyKey: "student-approve" },
      ),
      {
        params: Promise.resolve({
          studentId: linked.studentId,
          redemptionId: created.redemption.id,
        }),
      },
    );
    expect(studentApprove.status).toBe(403);
  });

  it("route matrix: list redemptions requires authenticated read access", async () => {
    const linked = await bootstrapLinkedParentStudent(db);

    clearMockSessionCookie();
    const unauthenticated = await listRedemptionsRoute(new Request("http://localhost/"), {
      params: Promise.resolve({ studentId: linked.studentId }),
    });
    expect(unauthenticated.status).toBe(401);

    withSessionCookie(linked.parentSession);
    const parentList = await listRedemptionsRoute(new Request("http://localhost/"), {
      params: Promise.resolve({ studentId: linked.studentId }),
    });
    expect(parentList.status).toBe(200);
  });
});
