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
      password: "Parent1aXy",
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
      password: "Parent1aXy",
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
      password: "Parent1aXy",
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
      password: "Parent1aXy",
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

  it("route matrix: unauthenticated access returns 401 on all m6 routes", async () => {
    const linked = await bootstrapLinkedParentStudent(db);
    const { item } = await bootstrapCatalogItem(db, {
      parentId: linked.parentId,
      studentId: linked.studentId,
    });
    const redemption = await createRedemptionRequest(db, {
      studentId: linked.studentId,
      actorId: linked.studentId,
      catalogItemId: item.id,
      idempotencyKey: "unauth-req",
    });

    clearMockSessionCookie();

    const catalogList = await getCatalogRoute(new Request("http://localhost/"), {
      params: Promise.resolve({ studentId: linked.studentId }),
    });
    expect(catalogList.status).toBe(401);

    const catalogCreate = await createCatalogRoute(
      jsonRequest(`http://localhost/api/family/students/${linked.studentId}/redemption-catalog`, {
        method: "POST",
        idempotencyKey: "unauth-create",
        body: JSON.stringify({ title: "X", cost: 5 }),
      }),
      { params: Promise.resolve({ studentId: linked.studentId }) },
    );
    expect(catalogCreate.status).toBe(401);

    const catalogUpdate = await updateCatalogRoute(
      jsonRequest(
        `http://localhost/api/family/students/${linked.studentId}/redemption-catalog/${item.id}`,
        {
          method: "PATCH",
          idempotencyKey: "unauth-update",
          body: JSON.stringify({ title: "Y" }),
        },
      ),
      { params: Promise.resolve({ studentId: linked.studentId, itemId: item.id }) },
    );
    expect(catalogUpdate.status).toBe(401);

    const redemptionList = await listRedemptionsRoute(new Request("http://localhost/"), {
      params: Promise.resolve({ studentId: linked.studentId }),
    });
    expect(redemptionList.status).toBe(401);

    const redemptionCreate = await createRedemptionRoute(
      jsonRequest(`http://localhost/api/family/students/${linked.studentId}/redemptions`, {
        method: "POST",
        idempotencyKey: "unauth-redemption",
        body: JSON.stringify({ catalogItemId: item.id }),
      }),
      { params: Promise.resolve({ studentId: linked.studentId }) },
    );
    expect(redemptionCreate.status).toBe(401);

    const approve = await approveRedemptionRoute(
      jsonRequest(
        `http://localhost/api/family/students/${linked.studentId}/redemptions/${redemption.redemption.id}/approve`,
        { method: "POST", idempotencyKey: "unauth-approve" },
      ),
      {
        params: Promise.resolve({
          studentId: linked.studentId,
          redemptionId: redemption.redemption.id,
        }),
      },
    );
    expect(approve.status).toBe(401);

    const reject = await rejectRedemptionRoute(
      jsonRequest(
        `http://localhost/api/family/students/${linked.studentId}/redemptions/${redemption.redemption.id}/reject`,
        {
          method: "POST",
          idempotencyKey: "unauth-reject",
          body: JSON.stringify({ reason: "No" }),
        },
      ),
      {
        params: Promise.resolve({
          studentId: linked.studentId,
          redemptionId: redemption.redemption.id,
        }),
      },
    );
    expect(reject.status).toBe(401);

    const cancel = await cancelRedemptionRoute(
      jsonRequest(
        `http://localhost/api/family/students/${linked.studentId}/redemptions/${redemption.redemption.id}/cancel`,
        { method: "POST", idempotencyKey: "unauth-cancel" },
      ),
      {
        params: Promise.resolve({
          studentId: linked.studentId,
          redemptionId: redemption.redemption.id,
        }),
      },
    );
    expect(cancel.status).toBe(401);
  });

  it("route matrix: cross-student access returns forbidden on all studentId routes", async () => {
    const linked = await bootstrapLinkedParentStudent(db);
    const outsider = await seedStudentUser(db, {
      username: `outsider_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });
    const { item } = await bootstrapCatalogItem(db, {
      parentId: linked.parentId,
      studentId: linked.studentId,
    });
    const redemption = await createRedemptionRequest(db, {
      studentId: linked.studentId,
      actorId: linked.studentId,
      catalogItemId: item.id,
      idempotencyKey: "cross-req",
    });

    withSessionCookie(linked.parentSession);

    const catalogList = await getCatalogRoute(new Request("http://localhost/"), {
      params: Promise.resolve({ studentId: outsider.studentId }),
    });
    expect(catalogList.status).toBe(403);

    const catalogCreate = await createCatalogRoute(
      jsonRequest(`http://localhost/api/family/students/${outsider.studentId}/redemption-catalog`, {
        method: "POST",
        idempotencyKey: "cross-create",
        body: JSON.stringify({ title: "X", cost: 5 }),
      }),
      { params: Promise.resolve({ studentId: outsider.studentId }) },
    );
    expect(catalogCreate.status).toBe(403);

    const catalogUpdate = await updateCatalogRoute(
      jsonRequest(
        `http://localhost/api/family/students/${outsider.studentId}/redemption-catalog/${item.id}`,
        {
          method: "PATCH",
          idempotencyKey: "cross-update",
          body: JSON.stringify({ title: "Y" }),
        },
      ),
      { params: Promise.resolve({ studentId: outsider.studentId, itemId: item.id }) },
    );
    expect(catalogUpdate.status).toBe(403);

    const redemptionList = await listRedemptionsRoute(new Request("http://localhost/"), {
      params: Promise.resolve({ studentId: outsider.studentId }),
    });
    expect(redemptionList.status).toBe(403);

    withSessionCookie(linked.studentSession);
    const redemptionCreate = await createRedemptionRoute(
      jsonRequest(`http://localhost/api/family/students/${outsider.studentId}/redemptions`, {
        method: "POST",
        idempotencyKey: "cross-redemption",
        body: JSON.stringify({ catalogItemId: item.id }),
      }),
      { params: Promise.resolve({ studentId: outsider.studentId }) },
    );
    expect(redemptionCreate.status).toBe(403);

    withSessionCookie(linked.parentSession);
    const approve = await approveRedemptionRoute(
      jsonRequest(
        `http://localhost/api/family/students/${outsider.studentId}/redemptions/${redemption.redemption.id}/approve`,
        { method: "POST", idempotencyKey: "cross-approve" },
      ),
      {
        params: Promise.resolve({
          studentId: outsider.studentId,
          redemptionId: redemption.redemption.id,
        }),
      },
    );
    expect(approve.status).toBe(403);

    const reject = await rejectRedemptionRoute(
      jsonRequest(
        `http://localhost/api/family/students/${outsider.studentId}/redemptions/${redemption.redemption.id}/reject`,
        {
          method: "POST",
          idempotencyKey: "cross-reject",
          body: JSON.stringify({ reason: "No" }),
        },
      ),
      {
        params: Promise.resolve({
          studentId: outsider.studentId,
          redemptionId: redemption.redemption.id,
        }),
      },
    );
    expect(reject.status).toBe(403);

    withSessionCookie(linked.studentSession);
    const cancel = await cancelRedemptionRoute(
      jsonRequest(
        `http://localhost/api/family/students/${outsider.studentId}/redemptions/${redemption.redemption.id}/cancel`,
        { method: "POST", idempotencyKey: "cross-cancel" },
      ),
      {
        params: Promise.resolve({
          studentId: outsider.studentId,
          redemptionId: redemption.redemption.id,
        }),
      },
    );
    expect(cancel.status).toBe(403);
  });

  it("route matrix: ended relationship blocks parent catalog and redemption command routes", async () => {
    const linked = await bootstrapLinkedParentStudent(db);
    const { item } = await bootstrapCatalogItem(db, {
      parentId: linked.parentId,
      studentId: linked.studentId,
    });
    const redemption = await createRedemptionRequest(db, {
      studentId: linked.studentId,
      actorId: linked.studentId,
      catalogItemId: item.id,
      idempotencyKey: "ended-req",
    });

    const { endRelationship } = await import("@/modules/family-access/end-relationship.service");
    const { relationships } = await import("@/db/schema");
    const [rel] = await db
      .select()
      .from(relationships)
      .where(
        and(
          eq(relationships.parentId, linked.parentId),
          eq(relationships.studentId, linked.studentId),
        ),
      );

    await endRelationship(db, {
      actorId: linked.parentId,
      relationshipId: rel!.id,
      idempotencyKey: "end-for-matrix",
    });

    const endedParentSession = await login(db, {
      identifier: linked.parentEmail,
      password: "Parent1aXy",
      idempotencyKey: `login-ended-matrix-${crypto.randomUUID().slice(0, 8)}`,
    });
    withSessionCookie(endedParentSession);

    const catalogList = await getCatalogRoute(new Request("http://localhost/"), {
      params: Promise.resolve({ studentId: linked.studentId }),
    });
    expect(catalogList.status).toBe(403);

    const catalogCreate = await createCatalogRoute(
      jsonRequest(`http://localhost/api/family/students/${linked.studentId}/redemption-catalog`, {
        method: "POST",
        idempotencyKey: "ended-create",
        body: JSON.stringify({ title: "X", cost: 5 }),
      }),
      { params: Promise.resolve({ studentId: linked.studentId }) },
    );
    expect(catalogCreate.status).toBe(403);

    const catalogUpdate = await updateCatalogRoute(
      jsonRequest(
        `http://localhost/api/family/students/${linked.studentId}/redemption-catalog/${item.id}`,
        {
          method: "PATCH",
          idempotencyKey: "ended-update",
          body: JSON.stringify({ title: "Y" }),
        },
      ),
      { params: Promise.resolve({ studentId: linked.studentId, itemId: item.id }) },
    );
    expect(catalogUpdate.status).toBe(403);

    const redemptionList = await listRedemptionsRoute(new Request("http://localhost/"), {
      params: Promise.resolve({ studentId: linked.studentId }),
    });
    expect(redemptionList.status).toBe(403);

    const approve = await approveRedemptionRoute(
      jsonRequest(
        `http://localhost/api/family/students/${linked.studentId}/redemptions/${redemption.redemption.id}/approve`,
        { method: "POST", idempotencyKey: "ended-approve" },
      ),
      {
        params: Promise.resolve({
          studentId: linked.studentId,
          redemptionId: redemption.redemption.id,
        }),
      },
    );
    expect(approve.status).toBe(403);

    const reject = await rejectRedemptionRoute(
      jsonRequest(
        `http://localhost/api/family/students/${linked.studentId}/redemptions/${redemption.redemption.id}/reject`,
        {
          method: "POST",
          idempotencyKey: "ended-reject",
          body: JSON.stringify({ reason: "No" }),
        },
      ),
      {
        params: Promise.resolve({
          studentId: linked.studentId,
          redemptionId: redemption.redemption.id,
        }),
      },
    );
    expect(reject.status).toBe(403);
  });

  it("route matrix: unknown resource IDs return not found on command routes", async () => {
    const linked = await bootstrapLinkedParentStudent(db);
    const unknownId = crypto.randomUUID();

    withSessionCookie(linked.parentSession);

    const catalogUpdate = await updateCatalogRoute(
      jsonRequest(
        `http://localhost/api/family/students/${linked.studentId}/redemption-catalog/${unknownId}`,
        {
          method: "PATCH",
          idempotencyKey: "unknown-catalog",
          body: JSON.stringify({ title: "Y" }),
        },
      ),
      { params: Promise.resolve({ studentId: linked.studentId, itemId: unknownId }) },
    );
    expect(catalogUpdate.status).toBe(404);

    withSessionCookie(linked.studentSession);
    const redemptionCreate = await createRedemptionRoute(
      jsonRequest(`http://localhost/api/family/students/${linked.studentId}/redemptions`, {
        method: "POST",
        idempotencyKey: "unknown-catalog-create",
        body: JSON.stringify({ catalogItemId: unknownId }),
      }),
      { params: Promise.resolve({ studentId: linked.studentId }) },
    );
    expect(redemptionCreate.status).toBe(404);

    withSessionCookie(linked.parentSession);
    const approve = await approveRedemptionRoute(
      jsonRequest(
        `http://localhost/api/family/students/${linked.studentId}/redemptions/${unknownId}/approve`,
        { method: "POST", idempotencyKey: "unknown-approve" },
      ),
      { params: Promise.resolve({ studentId: linked.studentId, redemptionId: unknownId }) },
    );
    expect(approve.status).toBe(404);

    const reject = await rejectRedemptionRoute(
      jsonRequest(
        `http://localhost/api/family/students/${linked.studentId}/redemptions/${unknownId}/reject`,
        {
          method: "POST",
          idempotencyKey: "unknown-reject",
          body: JSON.stringify({ reason: "No" }),
        },
      ),
      { params: Promise.resolve({ studentId: linked.studentId, redemptionId: unknownId }) },
    );
    expect(reject.status).toBe(404);

    withSessionCookie(linked.studentSession);
    const cancel = await cancelRedemptionRoute(
      jsonRequest(
        `http://localhost/api/family/students/${linked.studentId}/redemptions/${unknownId}/cancel`,
        { method: "POST", idempotencyKey: "unknown-cancel" },
      ),
      { params: Promise.resolve({ studentId: linked.studentId, redemptionId: unknownId }) },
    );
    expect(cancel.status).toBe(404);
  });

  it("route matrix: invalid DTO returns 400 on body routes", async () => {
    const linked = await bootstrapLinkedParentStudent(db);
    const { item } = await bootstrapCatalogItem(db, {
      parentId: linked.parentId,
      studentId: linked.studentId,
    });
    const redemption = await createRedemptionRequest(db, {
      studentId: linked.studentId,
      actorId: linked.studentId,
      catalogItemId: item.id,
      idempotencyKey: "dto-req",
    });

    withSessionCookie(linked.parentSession);

    const invalidCatalogCreate = await createCatalogRoute(
      jsonRequest(`http://localhost/api/family/students/${linked.studentId}/redemption-catalog`, {
        method: "POST",
        idempotencyKey: "invalid-catalog-create",
        body: JSON.stringify({ title: "", cost: 0 }),
      }),
      { params: Promise.resolve({ studentId: linked.studentId }) },
    );
    expect(invalidCatalogCreate.status).toBe(400);

    const invalidCatalogUpdate = await updateCatalogRoute(
      jsonRequest(
        `http://localhost/api/family/students/${linked.studentId}/redemption-catalog/${item.id}`,
        {
          method: "PATCH",
          idempotencyKey: "invalid-catalog-update",
          body: JSON.stringify({ cost: -1 }),
        },
      ),
      { params: Promise.resolve({ studentId: linked.studentId, itemId: item.id }) },
    );
    expect(invalidCatalogUpdate.status).toBe(400);

    withSessionCookie(linked.studentSession);
    const invalidRedemptionCreate = await createRedemptionRoute(
      jsonRequest(`http://localhost/api/family/students/${linked.studentId}/redemptions`, {
        method: "POST",
        idempotencyKey: "invalid-redemption-create",
        body: JSON.stringify({ catalogItemId: "not-a-uuid" }),
      }),
      { params: Promise.resolve({ studentId: linked.studentId }) },
    );
    expect(invalidRedemptionCreate.status).toBe(400);

    withSessionCookie(linked.parentSession);
    const invalidReject = await rejectRedemptionRoute(
      jsonRequest(
        `http://localhost/api/family/students/${linked.studentId}/redemptions/${redemption.redemption.id}/reject`,
        {
          method: "POST",
          idempotencyKey: "invalid-reject-dto",
          body: JSON.stringify({ reason: "" }),
        },
      ),
      {
        params: Promise.resolve({
          studentId: linked.studentId,
          redemptionId: redemption.redemption.id,
        }),
      },
    );
    expect(invalidReject.status).toBe(400);
  });

  it("route matrix: write routes require Idempotency-Key header", async () => {
    const linked = await bootstrapLinkedParentStudent(db);
    const { item } = await bootstrapCatalogItem(db, {
      parentId: linked.parentId,
      studentId: linked.studentId,
    });
    const redemption = await createRedemptionRequest(db, {
      studentId: linked.studentId,
      actorId: linked.studentId,
      catalogItemId: item.id,
      idempotencyKey: "idem-req",
    });

    withSessionCookie(linked.parentSession);

    const catalogCreate = await createCatalogRoute(
      jsonRequest(`http://localhost/api/family/students/${linked.studentId}/redemption-catalog`, {
        method: "POST",
        body: JSON.stringify({ title: "X", cost: 5 }),
      }),
      { params: Promise.resolve({ studentId: linked.studentId }) },
    );
    expect(catalogCreate.status).toBe(400);

    const catalogUpdate = await updateCatalogRoute(
      jsonRequest(
        `http://localhost/api/family/students/${linked.studentId}/redemption-catalog/${item.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ title: "Y" }),
        },
      ),
      { params: Promise.resolve({ studentId: linked.studentId, itemId: item.id }) },
    );
    expect(catalogUpdate.status).toBe(400);

    withSessionCookie(linked.studentSession);
    const redemptionCreate = await createRedemptionRoute(
      jsonRequest(`http://localhost/api/family/students/${linked.studentId}/redemptions`, {
        method: "POST",
        body: JSON.stringify({ catalogItemId: item.id }),
      }),
      { params: Promise.resolve({ studentId: linked.studentId }) },
    );
    expect(redemptionCreate.status).toBe(400);

    withSessionCookie(linked.parentSession);
    const approve = await approveRedemptionRoute(
      jsonRequest(
        `http://localhost/api/family/students/${linked.studentId}/redemptions/${redemption.redemption.id}/approve`,
        { method: "POST" },
      ),
      {
        params: Promise.resolve({
          studentId: linked.studentId,
          redemptionId: redemption.redemption.id,
        }),
      },
    );
    expect(approve.status).toBe(400);

    const reject = await rejectRedemptionRoute(
      jsonRequest(
        `http://localhost/api/family/students/${linked.studentId}/redemptions/${redemption.redemption.id}/reject`,
        {
          method: "POST",
          body: JSON.stringify({ reason: "No" }),
        },
      ),
      {
        params: Promise.resolve({
          studentId: linked.studentId,
          redemptionId: redemption.redemption.id,
        }),
      },
    );
    expect(reject.status).toBe(400);

    withSessionCookie(linked.studentSession);
    const cancel = await cancelRedemptionRoute(
      jsonRequest(
        `http://localhost/api/family/students/${linked.studentId}/redemptions/${redemption.redemption.id}/cancel`,
        { method: "POST" },
      ),
      {
        params: Promise.resolve({
          studentId: linked.studentId,
          redemptionId: redemption.redemption.id,
        }),
      },
    );
    expect(cancel.status).toBe(400);
  });
});
