import { config } from "dotenv";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import "./helpers/auth-mock";
import { clearMockSessionCookie } from "./helpers/auth-mock";
import { bootstrapLinkedParentStudent, withSessionCookie } from "./helpers/session";
import { GET as getTrainingTrendsRoute } from "@/app/api/family/students/[studentId]/training-trends/route";
import { endRelationship } from "@/modules/family-access/end-relationship.service";
import { login } from "@/modules/identity/login.service";
import { relationships } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { REACTION_TRAINING_KEY, STROOP_TRAINING_KEY } from "@/modules/training/constants";
import {
  completeReactionSession,
  completeStroopSession,
  ensureM5TrainingDefinitions,
} from "../../helpers/training";
import { closeTestDb, getTestDb, migrateTestDb, resetIdentityTables } from "../../helpers/db";

config({ path: ".env.local" });
config({ path: ".env" });

const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);

function trendsRequest(studentId: string, trainingKey: string, window = "7d") {
  return new Request(
    `http://localhost/api/family/students/${studentId}/training-trends?trainingKey=${trainingKey}&window=${window}`,
    { method: "GET" },
  );
}

describe.skipIf(!hasDb)("M5 training trends api routes", () => {
  const db = getTestDb();

  beforeAll(async () => {
    process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";
    await migrateTestDb();
  });

  beforeEach(async () => {
    clearMockSessionCookie();
    await resetIdentityTables(db);
    await ensureM5TrainingDefinitions(db);
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("AC-M5-05: student reads own typed trend DTO via route", async () => {
    const linked = await bootstrapLinkedParentStudent(db);
    withSessionCookie(linked.studentSession);

    await completeStroopSession(db, linked.studentId, {
      startIdempotencyKey: "route-student-start",
      submitIdempotencyKey: "route-student-submit",
    });

    const response = await getTrainingTrendsRoute(
      trendsRequest(linked.studentId, STROOP_TRAINING_KEY, "all"),
      {
        params: Promise.resolve({ studentId: linked.studentId }),
      },
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.studentId).toBe(linked.studentId);
    expect(payload.trainingKey).toBe(STROOP_TRAINING_KEY);
    expect(payload.window).toBe("all");
    expect(payload.segments[0]?.points[0]).toMatchObject({
      sessionKind: "effective",
      metrics: expect.arrayContaining([
        expect.objectContaining({ metricKey: "congruent_accuracy" }),
      ]),
    });
  });

  it("AC-M5-07 / R-M5-08: parent reads linked student trends", async () => {
    const linked = await bootstrapLinkedParentStudent(db);
    withSessionCookie(linked.parentSession);

    await completeReactionSession(db, linked.studentId, {
      startIdempotencyKey: "route-parent-start",
      submitIdempotencyKey: "route-parent-submit",
    });

    const response = await getTrainingTrendsRoute(
      trendsRequest(linked.studentId, REACTION_TRAINING_KEY, "all"),
      {
        params: Promise.resolve({ studentId: linked.studentId }),
      },
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.hasData).toBe(true);
  });

  it("AC-M5-07 / R-M5-08: unrelated parent receives 403 without existence leak", async () => {
    const linked = await bootstrapLinkedParentStudent(db);
    const other = await bootstrapLinkedParentStudent(db);
    withSessionCookie(other.parentSession);

    const response = await getTrainingTrendsRoute(
      trendsRequest(linked.studentId, REACTION_TRAINING_KEY),
      {
        params: Promise.resolve({ studentId: linked.studentId }),
      },
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "FORBIDDEN" },
    });
  });

  it("AC-M5-07 / R-M5-08: student cannot read another student trends", async () => {
    const linked = await bootstrapLinkedParentStudent(db);
    const other = await bootstrapLinkedParentStudent(db);
    withSessionCookie(linked.studentSession);

    const response = await getTrainingTrendsRoute(
      trendsRequest(other.studentId, REACTION_TRAINING_KEY),
      {
        params: Promise.resolve({ studentId: other.studentId }),
      },
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "FORBIDDEN" },
    });
  });

  it("AC-M5-07: ended relationship immediately blocks parent trend read", async () => {
    const linked = await bootstrapLinkedParentStudent(db);
    withSessionCookie(linked.parentSession);

    await completeReactionSession(db, linked.studentId, {
      startIdempotencyKey: "route-end-start",
      submitIdempotencyKey: "route-end-submit",
    });

    const [relationship] = await db
      .select({ id: relationships.id })
      .from(relationships)
      .where(
        and(
          eq(relationships.parentId, linked.parentId),
          eq(relationships.studentId, linked.studentId),
        ),
      )
      .limit(1);

    await endRelationship(db, {
      actorId: linked.parentId,
      relationshipId: relationship!.id,
      idempotencyKey: `route-end-${crypto.randomUUID()}`,
    });

    const refreshedParentSession = await login(db, {
      identifier: linked.parentEmail,
      password: "ParentPass123!Parent",
      idempotencyKey: `route-end-login-${crypto.randomUUID()}`,
    });
    withSessionCookie(refreshedParentSession);

    const response = await getTrainingTrendsRoute(
      trendsRequest(linked.studentId, REACTION_TRAINING_KEY, "all"),
      {
        params: Promise.resolve({ studentId: linked.studentId }),
      },
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "FORBIDDEN" },
    });
  });

  it("R-M5-08: invalid query params return validation error envelope", async () => {
    const linked = await bootstrapLinkedParentStudent(db);
    withSessionCookie(linked.studentSession);

    const response = await getTrainingTrendsRoute(
      new Request(
        `http://localhost/api/family/students/${linked.studentId}/training-trends?trainingKey=unknown&window=7d`,
        { method: "GET" },
      ),
      { params: Promise.resolve({ studentId: linked.studentId }) },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
  });
});
