import { config } from "dotenv";
import { and, eq, isNotNull } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { familyMemberships, relationships } from "@/db/schema";
import { login, validateSession } from "@/modules/identity/login.service";
import { endRelationship } from "@/modules/family-access/end-relationship.service";
import { issueAssociationCode } from "@/modules/family-access/association-code.service";
import {
  acceptRelationshipRequest,
  createRelationshipRequest,
  getStudentProfileForParent,
} from "@/modules/family-access/relationship-request.service";
import { getTrainingSummaryForParent } from "@/modules/training/session.service";
import { bootstrapVerifiedParentWithInvite, seedStudentUser } from "../../helpers/family-access";
import { completeReactionSession, ensureReactionDefinitions } from "../../helpers/training";
import { closeTestDb, getTestDb, migrateTestDb, resetIdentityTables } from "../../helpers/db";

config({ path: ".env.local" });
config({ path: ".env" });

const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("end relationship", () => {
  const db = getTestDb();

  beforeAll(async () => {
    process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";
    await migrateTestDb();
  });

  beforeEach(async () => {
    await resetIdentityTables(db);
    await ensureReactionDefinitions(db);
  });

  afterAll(async () => {
    await closeTestDb();
  });

  async function setupActiveRelationship() {
    const parentEmail = `parent-${crypto.randomUUID()}@test.local`;
    const parentPassword = "Parent1aXy";
    const { parentId } = await bootstrapVerifiedParentWithInvite(db, parentEmail);
    const student = await seedStudentUser(db, {
      username: `student_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });

    const code = await issueAssociationCode(db, {
      studentId: student.studentId,
      idempotencyKey: `issue-${crypto.randomUUID()}`,
    });
    const pending = await createRelationshipRequest(db, {
      parentId,
      associationCodePlaintext: code.codePlaintext,
      idempotencyKey: `req-${crypto.randomUUID()}`,
    });
    const accepted = await acceptRelationshipRequest(db, {
      studentId: student.studentId,
      requestId: pending.requestId,
      idempotencyKey: `accept-${crypto.randomUUID()}`,
    });

    return {
      parentId,
      parentEmail,
      parentPassword,
      studentId: student.studentId,
      relationshipId: accepted.relationshipId,
      familyId: accepted.familyId,
    };
  }

  it("ends relationship by parent and revokes parent reads immediately", async () => {
    const { parentId, studentId, relationshipId, familyId } = await setupActiveRelationship();
    await completeReactionSession(db, studentId);

    await getStudentProfileForParent(db, parentId, studentId);
    await getTrainingSummaryForParent(db, parentId, studentId);

    const ended = await endRelationship(db, {
      actorId: parentId,
      relationshipId,
      idempotencyKey: "end-by-parent",
    });

    expect(ended.status).toBe("ended");
    expect(ended.idempotentReplay).toBe(false);

    const [relationship] = await db
      .select()
      .from(relationships)
      .where(eq(relationships.id, relationshipId))
      .limit(1);
    expect(relationship?.status).toBe("ended");
    expect(relationship?.endedAt).toBeTruthy();
    expect(relationship?.endedBy).toBe(parentId);

    const memberships = await db
      .select()
      .from(familyMemberships)
      .where(and(eq(familyMemberships.familyId, familyId), isNotNull(familyMemberships.leftAt)));
    expect(memberships).toHaveLength(2);

    await expect(getStudentProfileForParent(db, parentId, studentId)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(getTrainingSummaryForParent(db, parentId, studentId)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("ends relationship by student and deduplicates by idempotency key", async () => {
    const { studentId, relationshipId } = await setupActiveRelationship();

    const first = await endRelationship(db, {
      actorId: studentId,
      relationshipId,
      idempotencyKey: "end-by-student",
    });
    const second = await endRelationship(db, {
      actorId: studentId,
      relationshipId,
      idempotencyKey: "end-by-student",
    });

    expect(first.idempotentReplay).toBe(false);
    expect(second.idempotentReplay).toBe(true);
    expect(second.relationshipId).toBe(relationshipId);
  });

  it("deduplicates parent end requests by idempotency key", async () => {
    const { parentId, relationshipId } = await setupActiveRelationship();

    const first = await endRelationship(db, {
      actorId: parentId,
      relationshipId,
      idempotencyKey: "end-by-parent-idem",
    });
    const second = await endRelationship(db, {
      actorId: parentId,
      relationshipId,
      idempotencyKey: "end-by-parent-idem",
    });

    expect(first.idempotentReplay).toBe(false);
    expect(second.idempotentReplay).toBe(true);
  });

  it("rejects end requests from users who are not on the relationship", async () => {
    const { parentId, studentId, relationshipId } = await setupActiveRelationship();
    const outsider = await seedStudentUser(db, {
      username: `outsider_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });
    const { parentId: otherParentId } = await bootstrapVerifiedParentWithInvite(
      db,
      `other-parent-${crypto.randomUUID()}@test.local`,
    );

    await expect(
      endRelationship(db, {
        actorId: outsider.studentId,
        relationshipId,
        idempotencyKey: "end-outsider-student",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await expect(
      endRelationship(db, {
        actorId: otherParentId,
        relationshipId,
        idempotencyKey: "end-outsider-parent",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const [relationship] = await db
      .select()
      .from(relationships)
      .where(eq(relationships.id, relationshipId))
      .limit(1);
    expect(relationship?.status).toBe("active");

    await getStudentProfileForParent(db, parentId, studentId);
  });

  it("denies parent reads immediately after student ends the relationship", async () => {
    const { parentId, studentId, relationshipId } = await setupActiveRelationship();
    await completeReactionSession(db, studentId);

    await endRelationship(db, {
      actorId: studentId,
      relationshipId,
      idempotencyKey: "end-by-student-access-check",
    });

    await expect(getStudentProfileForParent(db, parentId, studentId)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(getTrainingSummaryForParent(db, parentId, studentId)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("invalidates parent sessions when relationship ends", async () => {
    const { parentId, parentEmail, parentPassword, relationshipId } =
      await setupActiveRelationship();

    const loginResult = await login(db, {
      identifier: parentEmail,
      password: parentPassword,
      idempotencyKey: "login-before-end",
    });

    await endRelationship(db, {
      actorId: parentId,
      relationshipId,
      idempotencyKey: "end-epoch",
    });

    const validated = await validateSession(db, loginResult.sessionId);
    expect(validated).toBeNull();
  });

  it("rejects ending an already ended relationship with a new idempotency key", async () => {
    const { parentId, relationshipId } = await setupActiveRelationship();

    await endRelationship(db, {
      actorId: parentId,
      relationshipId,
      idempotencyKey: "end-first",
    });

    await expect(
      endRelationship(db, {
        actorId: parentId,
        relationshipId,
        idempotencyKey: "end-second",
      }),
    ).rejects.toMatchObject({ code: "RELATIONSHIP_NOT_ACTIVE" });
  });
});
