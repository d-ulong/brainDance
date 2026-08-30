import { config } from "dotenv";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import "./helpers/auth-mock";
import { clearMockSessionCookie, setMockSessionCookie } from "./helpers/auth-mock";
import { withSessionCookie } from "./helpers/session";
import { GET as getStudentProfileRoute } from "@/app/api/family/students/[studentId]/profile/route";
import { POST as endRelationshipRoute } from "@/app/api/relationships/[relationshipId]/end/route";
import {
  DELETE as deleteReflectionRoute,
  GET as getReflectionRoute,
  PUT as upsertReflectionRoute,
} from "@/app/api/students/[studentId]/daily-reflections/[familyDate]/route";
import { POST as grantReflectionRoute } from "@/app/api/students/[studentId]/daily-reflections/[familyDate]/grants/route";
import { DELETE as revokeReflectionGrantRoute } from "@/app/api/students/[studentId]/daily-reflections/[familyDate]/grants/[parentId]/route";
import { login } from "@/modules/identity/login.service";
import { toFamilyDate } from "@/modules/time-policy/to-family-date";
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

  it("P2-R01: private reflection route returns 403 without body leak for ungranted parent", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const { parentId: parent1Id } = await bootstrapVerifiedParentWithInvite(
      db,
      `parent1_${suffix}@test.local`,
    );
    const { parentId: parent2Id } = await bootstrapVerifiedParentWithInvite(
      db,
      `parent2_${suffix}@test.local`,
    );
    const student = await seedStudentUser(db, {
      username: `student_${suffix}`,
      password: "StudentPass123!Student",
    });

    await acceptParentForStudent(db, { parentId: parent1Id, studentId: student.studentId });
    await acceptParentForStudent(db, { parentId: parent2Id, studentId: student.studentId });

    const studentSession = await login(db, {
      identifier: student.username,
      password: student.password,
      idempotencyKey: `login-student-${suffix}`,
    });
    withSessionCookie(studentSession);

    const familyDate = toFamilyDate();
    const upsertResponse = await upsertReflectionRoute(
      new Request(
        `http://localhost/api/students/${student.studentId}/daily-reflections/${familyDate}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            body: "Route private secret content",
            visibility: "private",
            idempotencyKey: `route-upsert-${suffix}`,
          }),
        },
      ),
      { params: Promise.resolve({ studentId: student.studentId, familyDate }) },
    );
    expect(upsertResponse.status).toBe(200);

    const grantResponse = await grantReflectionRoute(
      new Request(
        `http://localhost/api/students/${student.studentId}/daily-reflections/${familyDate}/grants`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            parentId: parent1Id,
            idempotencyKey: `route-grant-${suffix}`,
          }),
        },
      ),
      { params: Promise.resolve({ studentId: student.studentId, familyDate }) },
    );
    expect(grantResponse.status).toBe(200);

    const parent2Session = await login(db, {
      identifier: `parent2_${suffix}@test.local`,
      password: "ParentPass123!Parent",
      idempotencyKey: `login-parent2-${suffix}`,
    });
    withSessionCookie(parent2Session);

    const forbiddenResponse = await getReflectionRoute(new Request(`http://localhost/`), {
      params: Promise.resolve({ studentId: student.studentId, familyDate }),
    });
    expect(forbiddenResponse.status).toBe(403);
    const forbiddenBody = JSON.stringify(await forbiddenResponse.json());
    expect(forbiddenBody).not.toContain("Route private secret content");
  });

  it("P2-R02: revoke grant returns 401 on stale parent session then 403 after refresh", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const email = `parent_${suffix}@test.local`;
    const { parentId } = await bootstrapVerifiedParentWithInvite(db, email);
    const student = await seedStudentUser(db, {
      username: `student_${suffix}`,
      password: "StudentPass123!Student",
    });
    await acceptParentForStudent(db, { parentId, studentId: student.studentId });

    const studentSession = await login(db, {
      identifier: student.username,
      password: student.password,
      idempotencyKey: `login-student-revoke-${suffix}`,
    });
    withSessionCookie(studentSession);

    const familyDate = toFamilyDate();
    await upsertReflectionRoute(
      new Request(
        `http://localhost/api/students/${student.studentId}/daily-reflections/${familyDate}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            body: "Revoke epoch secret",
            visibility: "private",
            idempotencyKey: `route-upsert-revoke-${suffix}`,
          }),
        },
      ),
      { params: Promise.resolve({ studentId: student.studentId, familyDate }) },
    );

    await grantReflectionRoute(
      new Request(
        `http://localhost/api/students/${student.studentId}/daily-reflections/${familyDate}/grants`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            parentId,
            idempotencyKey: `route-grant-revoke-${suffix}`,
          }),
        },
      ),
      { params: Promise.resolve({ studentId: student.studentId, familyDate }) },
    );

    const parentSession = await login(db, {
      identifier: email,
      password: "ParentPass123!Parent",
      idempotencyKey: `login-parent-revoke-${suffix}`,
    });
    withSessionCookie(parentSession);

    const beforeRevoke = await getReflectionRoute(new Request(`http://localhost/`), {
      params: Promise.resolve({ studentId: student.studentId, familyDate }),
    });
    expect(beforeRevoke.status).toBe(200);

    withSessionCookie(studentSession);
    await revokeReflectionGrantRoute(
      new Request(
        `http://localhost/api/students/${student.studentId}/daily-reflections/${familyDate}/grants/${parentId}`,
        {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ idempotencyKey: `route-revoke-${suffix}` }),
        },
      ),
      { params: Promise.resolve({ studentId: student.studentId, familyDate, parentId }) },
    );

    withSessionCookie(parentSession);
    const staleResponse = await getReflectionRoute(new Request(`http://localhost/`), {
      params: Promise.resolve({ studentId: student.studentId, familyDate }),
    });
    expect(staleResponse.status).toBe(401);

    const refreshedParentSession = await login(db, {
      identifier: email,
      password: "ParentPass123!Parent",
      idempotencyKey: `login-parent-revoke-fresh-${suffix}`,
    });
    withSessionCookie(refreshedParentSession);

    const forbiddenResponse = await getReflectionRoute(new Request(`http://localhost/`), {
      params: Promise.resolve({ studentId: student.studentId, familyDate }),
    });
    expect(forbiddenResponse.status).toBe(403);
    const forbiddenBody = JSON.stringify(await forbiddenResponse.json());
    expect(forbiddenBody).not.toContain("Revoke epoch secret");
  });

  it("P2-R03: student delete reflection returns 404 for subsequent reads", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const student = await seedStudentUser(db, {
      username: `student_${suffix}`,
      password: "StudentPass123!Student",
    });

    const studentSession = await login(db, {
      identifier: student.username,
      password: student.password,
      idempotencyKey: `login-student-del-${suffix}`,
    });
    withSessionCookie(studentSession);

    const familyDate = toFamilyDate();
    await upsertReflectionRoute(
      new Request(
        `http://localhost/api/students/${student.studentId}/daily-reflections/${familyDate}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            body: "Delete via route",
            visibility: "normal",
            idempotencyKey: `route-upsert-del-${suffix}`,
          }),
        },
      ),
      { params: Promise.resolve({ studentId: student.studentId, familyDate }) },
    );

    const deleteResponse = await deleteReflectionRoute(
      new Request(
        `http://localhost/api/students/${student.studentId}/daily-reflections/${familyDate}`,
        {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ idempotencyKey: `route-delete-${suffix}` }),
        },
      ),
      { params: Promise.resolve({ studentId: student.studentId, familyDate }) },
    );
    expect(deleteResponse.status).toBe(200);

    const readResponse = await getReflectionRoute(new Request(`http://localhost/`), {
      params: Promise.resolve({ studentId: student.studentId, familyDate }),
    });
    expect(readResponse.status).toBe(404);
  });
});
