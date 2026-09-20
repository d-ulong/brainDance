import { config } from "dotenv";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import "./helpers/auth-mock";
import { clearMockSessionCookie } from "./helpers/auth-mock";
import { bootstrapLinkedParentStudent, withSessionCookie } from "./helpers/session";
import { POST as postGoals } from "@/app/api/goals/route";
import { POST as completeGoalRoute } from "@/app/api/goals/[assignmentId]/complete/route";
import { closeTestDb, getTestDb, migrateTestDb, resetIdentityTables } from "../../helpers/db";

config({ path: ".env.local" });
config({ path: ".env" });

const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("POST /api/goals/[assignmentId]/complete", () => {
  const db = getTestDb();

  beforeAll(async () => {
    await migrateTestDb();
  });

  beforeEach(async () => {
    clearMockSessionCookie();
    await resetIdentityTables(db);
  });

  afterAll(async () => {
    await closeTestDb();
  });

  async function createActiveAssignment(linked: Awaited<ReturnType<typeof bootstrapLinkedParentStudent>>) {
    withSessionCookie(linked.parentSession);
    const response = await postGoals(
      new Request("http://localhost/api/goals", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": `goal-${crypto.randomUUID()}`,
        },
        body: JSON.stringify({
          subjectIds: [linked.studentId],
          content: "路由完成测试",
          dueDate: "2026-12-01",
          horizon: "medium",
        }),
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    return body.assignmentIds[0] as string;
  }

  it("requires Idempotency-Key and completes for the subject", async () => {
    const linked = await bootstrapLinkedParentStudent(db);
    const assignmentId = await createActiveAssignment(linked);

    withSessionCookie(linked.studentSession);
    const missingKey = await completeGoalRoute(
      new Request(`http://localhost/api/goals/${assignmentId}/complete`, { method: "POST" }),
      { params: Promise.resolve({ assignmentId }) },
    );
    expect(missingKey.status).toBe(400);
    const missingBody = await missingKey.json();
    expect(missingBody.error?.code).toBe("IDEMPOTENCY_KEY_REQUIRED");

    const complete = await completeGoalRoute(
      new Request(`http://localhost/api/goals/${assignmentId}/complete`, {
        method: "POST",
        headers: { "Idempotency-Key": "route-complete-1" },
      }),
      { params: Promise.resolve({ assignmentId }) },
    );
    expect(complete.status).toBe(200);
    const payload = await complete.json();
    expect(payload.status).toBe("completed");

    withSessionCookie(linked.studentSession);
    const replay = await completeGoalRoute(
      new Request(`http://localhost/api/goals/${assignmentId}/complete`, {
        method: "POST",
        headers: { "Idempotency-Key": "route-complete-1" },
      }),
      { params: Promise.resolve({ assignmentId }) },
    );
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(payload);
  });

  it("rejects parent and other students", async () => {
    const linked = await bootstrapLinkedParentStudent(db);
    const other = await bootstrapLinkedParentStudent(db);
    const assignmentId = await createActiveAssignment(linked);

    withSessionCookie(linked.parentSession);
    const parentAttempt = await completeGoalRoute(
      new Request(`http://localhost/api/goals/${assignmentId}/complete`, {
        method: "POST",
        headers: { "Idempotency-Key": "parent-complete" },
      }),
      { params: Promise.resolve({ assignmentId }) },
    );
    expect(parentAttempt.status).toBe(403);

    withSessionCookie(other.studentSession);
    const otherAttempt = await completeGoalRoute(
      new Request(`http://localhost/api/goals/${assignmentId}/complete`, {
        method: "POST",
        headers: { "Idempotency-Key": "other-complete" },
      }),
      { params: Promise.resolve({ assignmentId }) },
    );
    expect(otherAttempt.status).toBe(403);
  });
});
