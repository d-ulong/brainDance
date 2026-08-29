import { config } from "dotenv";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import "./helpers/auth-mock";
import { clearMockSessionCookie, setMockSessionCookie } from "./helpers/auth-mock";
import { withSessionCookie } from "./helpers/session";
import { GET as getStudentProfileRoute } from "@/app/api/family/students/[studentId]/profile/route";
import { POST as endRelationshipRoute } from "@/app/api/relationships/[relationshipId]/end/route";
import { login } from "@/modules/identity/login.service";
import {
  acceptParentForStudent,
  bootstrapVerifiedParentWithInvite,
  seedStudentUser,
} from "../../helpers/family-access";
import { closeTestDb, getTestDb, migrateTestDb, resetIdentityTables } from "../../helpers/db";

config({ path: ".env.local" });
config({ path: ".env" });

const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("m4 api routes", () => {
  const db = getTestDb();

  beforeAll(async () => {
    process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";
    await migrateTestDb();
  });

  beforeEach(async () => {
    clearMockSessionCookie();
    await resetIdentityTables(db);
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("P1-R04: ending one student relationship returns 403 for ended student and 200 for remaining student", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const email = `parent_${suffix}@test.local`;
    const { parentId } = await bootstrapVerifiedParentWithInvite(db, email);
    const student1 = await seedStudentUser(db, {
      username: `student1_${suffix}`,
      password: "StudentPass123!Student",
      displayName: "Ended Student Secret Name",
    });
    const student2 = await seedStudentUser(db, {
      username: `student2_${suffix}`,
      password: "StudentPass123!Student",
      displayName: "Remaining Student",
    });

    const rel1 = await acceptParentForStudent(db, {
      parentId,
      studentId: student1.studentId,
      idempotencySuffix: "route-s1",
    });
    await acceptParentForStudent(db, {
      parentId,
      studentId: student2.studentId,
      idempotencySuffix: "route-s2",
    });

    const parentSession = await login(db, {
      identifier: email,
      password: "ParentPass123!Parent",
      idempotencyKey: `login-parent:${suffix}`,
    });
    withSessionCookie(parentSession);

    const beforeEnd = await getStudentProfileRoute(new Request("http://localhost/"), {
      params: Promise.resolve({ studentId: student1.studentId }),
    });
    expect(beforeEnd.status).toBe(200);

    const endResponse = await endRelationshipRoute(
      new Request(`http://localhost/api/relationships/${rel1.relationshipId}/end`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idempotencyKey: "route-end-student1" }),
      }),
      { params: Promise.resolve({ relationshipId: rel1.relationshipId }) },
    );
    expect(endResponse.status).toBe(200);

    const staleCookieResponse = await getStudentProfileRoute(new Request("http://localhost/"), {
      params: Promise.resolve({ studentId: student1.studentId }),
    });
    expect(staleCookieResponse.status).toBe(401);

    const setCookieHeader = endResponse.headers.get("set-cookie");
    expect(setCookieHeader).toBeTruthy();
    const refreshedCookie = setCookieHeader!.split(";")[0]!.split("=").slice(1).join("=");
    setMockSessionCookie(refreshedCookie);

    const forbiddenResponse = await getStudentProfileRoute(new Request("http://localhost/"), {
      params: Promise.resolve({ studentId: student1.studentId }),
    });
    expect(forbiddenResponse.status).toBe(403);
    const forbiddenBody = JSON.stringify(await forbiddenResponse.json());
    expect(forbiddenBody).not.toContain("Ended Student Secret Name");
    expect(forbiddenBody).not.toContain(student1.studentId);

    const allowedResponse = await getStudentProfileRoute(new Request("http://localhost/"), {
      params: Promise.resolve({ studentId: student2.studentId }),
    });
    expect(allowedResponse.status).toBe(200);
    const allowedPayload = await allowedResponse.json();
    expect(allowedPayload.displayName).toBe("Remaining Student");
  });
});
