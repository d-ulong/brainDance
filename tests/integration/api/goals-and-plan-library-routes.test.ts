import { config } from "dotenv";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import "./helpers/auth-mock";
import { clearMockSessionCookie } from "./helpers/auth-mock";
import { bootstrapLinkedParentStudent, withSessionCookie } from "./helpers/session";
import { GET as getGoals, POST as postGoals } from "@/app/api/goals/route";
import { GET as getPlanLibrary, POST as postPlanLibrary } from "@/app/api/plan-library/route";
import { closeTestDb, getTestDb, migrateTestDb, resetIdentityTables } from "../../helpers/db";
import { resetScheduleTables } from "../../helpers/schedule";

config({ path: ".env.local" });
config({ path: ".env" });

const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("goals and plan-library read/write routes", () => {
  const db = getTestDb();

  beforeAll(async () => {
    await migrateTestDb();
  });

  beforeEach(async () => {
    clearMockSessionCookie();
    await resetIdentityTables(db);
    await resetScheduleTables(db);
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("parent GET/POST /api/goals and GET /api/plan-library return JSON instead of 500", async () => {
    const linked = await bootstrapLinkedParentStudent(db);
    withSessionCookie(linked.parentSession);

    const listGoals = await getGoals();
    expect(listGoals.status).toBe(200);
    const goalsPayload = await listGoals.json();
    expect(goalsPayload).toEqual({ goals: [] });
    expect(goalsPayload.error).toBeUndefined();

    const createGoals = await postGoals(
      new Request("http://localhost/api/goals", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": "route-goal-create",
        },
        body: JSON.stringify({
          subjectIds: [linked.studentId],
          content: "完成数学练习",
          dueDate: "2026-10-01",
          horizon: "short",
        }),
      }),
    );
    expect(createGoals.status).toBe(200);
    const created = await createGoals.json();
    expect(created.definitionId).toBeTruthy();
    expect(created.assignmentIds).toHaveLength(1);
    expect(created.error).toBeUndefined();

    const listedAfterCreate = await getGoals();
    expect(listedAfterCreate.status).toBe(200);
    const listedPayload = await listedAfterCreate.json();
    expect(listedPayload.goals?.[0]?.horizon).toBe("short");
    expect(listedPayload.goals?.[0]?.content).toBe("完成数学练习");
    expect(listedPayload.error).toBeUndefined();

    const listPlans = await getPlanLibrary();
    expect(listPlans.status).toBe(200);
    const plansPayload = await listPlans.json();
    expect(plansPayload).toEqual({ plans: [] });
    expect(plansPayload.error).toBeUndefined();
  });

  it("student GET /api/goals and GET /api/plan-library return JSON instead of 500", async () => {
    const linked = await bootstrapLinkedParentStudent(db);
    withSessionCookie(linked.studentSession);

    const listGoals = await getGoals();
    expect(listGoals.status).toBe(200);
    expect(await listGoals.json()).toEqual({ goals: [] });

    const listPlans = await getPlanLibrary();
    expect(listPlans.status).toBe(200);
    expect(await listPlans.json()).toEqual({ plans: [] });
  });

  it("parent can create a plan library entry over HTTP", async () => {
    const linked = await bootstrapLinkedParentStudent(db);
    withSessionCookie(linked.parentSession);

    const response = await postPlanLibrary(
      new Request("http://localhost/api/plan-library", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": "route-plan-create",
        },
        body: JSON.stringify({
          priority: 0,
          definition: {
            title: "路由计划",
            startDate: "2026-01-15",
            entries: [
              {
                key: "reading",
                title: "阅读",
                expectedTime: "19:00",
                repeat: { kind: "daily" },
                points: {
                  onTimeWithin: 1,
                  onTimeOver: 0,
                  lateWithin: 0,
                  lateOver: 0,
                  incomplete: 0,
                },
              },
            ],
          },
        }),
      }),
    );
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.plan?.definition?.title).toBe("路由计划");
    expect(payload.error).toBeUndefined();
  });
});
