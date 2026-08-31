import { config } from "dotenv";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import "./helpers/auth-mock";
import { clearMockSessionCookie } from "./helpers/auth-mock";
import { withSessionCookie } from "./helpers/session";
import {
  GET as getCatalogRoute,
  POST as createCatalogRoute,
} from "@/app/api/family/students/[studentId]/redemption-catalog/route";
import { POST as createRedemptionRoute } from "@/app/api/family/students/[studentId]/redemptions/route";
import { POST as approveRedemptionRoute } from "@/app/api/family/students/[studentId]/redemptions/[redemptionId]/approve/route";
import { login } from "@/modules/identity/login.service";
import { bootstrapVerifiedParentWithInvite, seedStudentUser } from "../../helpers/family-access";
import { closeTestDb, getTestDb, migrateTestDb, resetIdentityTables } from "../../helpers/db";
import {
  bootstrapCatalogItem,
  resetRedemptionTables,
  seedStudentBalance,
} from "../../helpers/redemption";
import { bootstrapParentStudentRelationship, resetScheduleTables } from "../../helpers/schedule";

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

    const { createRedemptionRequest } = await import("@/modules/redemption/redemption.service");
    const redemption = await createRedemptionRequest(db, {
      studentId,
      actorId: studentId,
      catalogItemId: item.id,
      idempotencyKey: "service-req",
    });

    const { endRelationship } = await import("@/modules/family-access/end-relationship.service");
    const { relationships } = await import("@/db/schema");
    const { eq, and } = await import("drizzle-orm");
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
});
