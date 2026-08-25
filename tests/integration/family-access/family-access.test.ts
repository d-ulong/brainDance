import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  auditEvents,
  guardianConsents,
  relationships,
  studentAssociationCodes,
  users,
} from "@/db/schema";
import { hashAssociationCode } from "@/lib/crypto";
import { login, validateSession } from "@/modules/identity/login.service";
import { createInvitation } from "@/modules/identity/invitation.service";
import { registerParent } from "@/modules/identity/registration.service";
import { getTrainingSummaryForParent } from "@/modules/training/session.service";
import { issueAssociationCode } from "@/modules/family-access/association-code.service";
import {
  acceptRelationshipRequest,
  createRelationshipRequest,
  getStudentProfileForParent,
  rejectRelationshipRequest,
} from "@/modules/family-access/relationship-request.service";
import { bootstrapVerifiedParentWithInvite, seedStudentUser } from "../../helpers/family-access";
import { bootstrapAdmin } from "../../helpers/identity";
import { closeTestDb, getTestDb, migrateTestDb, resetIdentityTables } from "../../helpers/db";
import { ensureReactionDefinitions } from "../../helpers/training";

config({ path: ".env.local" });
config({ path: ".env" });

const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("family access module", () => {
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

  async function setupPair() {
    const parentEmail = `parent-${crypto.randomUUID()}@test.local`;
    const { parentId } = await bootstrapVerifiedParentWithInvite(db, parentEmail);
    const student = await seedStudentUser(db, {
      username: `student_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });
    return { parentId, ...student };
  }

  it("stores association code hash only and rejects expired/consumed codes", async () => {
    const student = await seedStudentUser(db, {
      username: "student_codes",
      password: "StudentPass123!Student",
    });

    const issued = await issueAssociationCode(db, {
      studentId: student.studentId,
      idempotencyKey: "issue-1",
    });

    expect(issued.codePlaintext.length).toBeGreaterThan(10);

    const [row] = await db
      .select()
      .from(studentAssociationCodes)
      .where(eq(studentAssociationCodes.id, issued.associationCodeId));

    expect(row?.codeHash).toBe(hashAssociationCode(issued.codePlaintext));
    expect(JSON.stringify(await db.select().from(auditEvents))).not.toContain(issued.codePlaintext);

    const { parentId } = await bootstrapVerifiedParentWithInvite(db, "parent-codes@test.local");

    const request = await createRelationshipRequest(db, {
      parentId,
      associationCodePlaintext: issued.codePlaintext,
      idempotencyKey: "req-1",
    });
    expect(request.idempotentReplay).toBe(false);

    await expect(
      createRelationshipRequest(db, {
        parentId,
        associationCodePlaintext: issued.codePlaintext,
        idempotencyKey: "req-2",
      }),
    ).rejects.toMatchObject({ code: "ASSOCIATION_CODE_CONSUMED" });

    const expired = await issueAssociationCode(db, {
      studentId: student.studentId,
      idempotencyKey: "issue-expired",
    });

    await db
      .update(studentAssociationCodes)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(studentAssociationCodes.id, expired.associationCodeId));

    await expect(
      createRelationshipRequest(db, {
        parentId,
        associationCodePlaintext: expired.codePlaintext,
        idempotencyKey: "req-expired",
      }),
    ).rejects.toMatchObject({ code: "ASSOCIATION_CODE_EXPIRED" });
  });

  it("denies parent access before acceptance and grants after acceptance", async () => {
    const { parentId, studentId } = await setupPair();
    const code = await issueAssociationCode(db, {
      studentId,
      idempotencyKey: "issue-access",
    });

    const pending = await createRelationshipRequest(db, {
      parentId,
      associationCodePlaintext: code.codePlaintext,
      idempotencyKey: "req-access",
    });

    await expect(getStudentProfileForParent(db, parentId, studentId)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    await expect(getTrainingSummaryForParent(db, parentId, studentId)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    await acceptRelationshipRequest(db, {
      studentId,
      requestId: pending.requestId,
      idempotencyKey: "accept-access",
    });

    const profile = await getStudentProfileForParent(db, parentId, studentId);
    expect(profile.studentId).toBe(studentId);
    expect(profile.displayName).toBeTruthy();
  });

  it("rejects relationship and keeps parent access denied", async () => {
    const { parentId, studentId } = await setupPair();
    const code = await issueAssociationCode(db, {
      studentId,
      idempotencyKey: "issue-reject",
    });

    const pending = await createRelationshipRequest(db, {
      parentId,
      associationCodePlaintext: code.codePlaintext,
      idempotencyKey: "req-reject",
    });

    await rejectRelationshipRequest(db, {
      studentId,
      requestId: pending.requestId,
      idempotencyKey: "reject-1",
    });

    await expect(getStudentProfileForParent(db, parentId, studentId)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    const rels = await db.select().from(relationships);
    expect(rels).toHaveLength(0);
  });

  it("creates family on first acceptance", async () => {
    const { parentId, studentId } = await setupPair();
    const code = await issueAssociationCode(db, {
      studentId,
      idempotencyKey: "issue-family",
    });

    const pending = await createRelationshipRequest(db, {
      parentId,
      associationCodePlaintext: code.codePlaintext,
      idempotencyKey: "req-family",
    });

    const accepted = await acceptRelationshipRequest(db, {
      studentId,
      requestId: pending.requestId,
      idempotencyKey: "accept-family",
    });

    expect(accepted.familyId).toBeTruthy();
    expect(accepted.idempotentReplay).toBe(false);

    const [consent] = await db
      .select()
      .from(guardianConsents)
      .where(eq(guardianConsents.studentId, studentId));
    expect(consent?.parentId).toBe(parentId);
    expect(consent?.policyVersion).toBe("policy-v0.1-m1");

    const [relationship] = await db
      .select()
      .from(relationships)
      .where(eq(relationships.id, accepted.relationshipId));
    expect(relationship?.status).toBe("active");
    expect(relationship?.familyId).toBe(accepted.familyId);
  });

  it("deduplicates concurrent relationship request creation by idempotency key", async () => {
    const { parentId, studentId } = await setupPair();
    const code = await issueAssociationCode(db, {
      studentId,
      idempotencyKey: "issue-concurrent",
    });

    const results = await Promise.allSettled([
      createRelationshipRequest(db, {
        parentId,
        associationCodePlaintext: code.codePlaintext,
        idempotencyKey: "same-key",
      }),
      createRelationshipRequest(db, {
        parentId,
        associationCodePlaintext: code.codePlaintext,
        idempotencyKey: "same-key",
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<
      Awaited<ReturnType<typeof createRelationshipRequest>>
    >[];
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);

    const requestIds = new Set(fulfilled.map((r) => r.value.requestId));
    expect(requestIds.size).toBe(1);
  });

  it("deduplicates concurrent acceptance by respond idempotency key", async () => {
    const { parentId, studentId } = await setupPair();
    const code = await issueAssociationCode(db, {
      studentId,
      idempotencyKey: "issue-accept-concurrent",
    });

    const pending = await createRelationshipRequest(db, {
      parentId,
      associationCodePlaintext: code.codePlaintext,
      idempotencyKey: "req-accept-concurrent",
    });

    const results = await Promise.allSettled([
      acceptRelationshipRequest(db, {
        studentId,
        requestId: pending.requestId,
        idempotencyKey: "accept-same",
      }),
      acceptRelationshipRequest(db, {
        studentId,
        requestId: pending.requestId,
        idempotencyKey: "accept-same",
      }),
    ]);

    expect(results.every((r) => r.status === "fulfilled")).toBe(true);

    const rels = await db.select().from(relationships);
    expect(rels).toHaveLength(1);
  });

  it("issues association code idempotently", async () => {
    const student = await seedStudentUser(db, {
      username: "student_idem",
      password: "StudentPass123!Student",
    });

    const first = await issueAssociationCode(db, {
      studentId: student.studentId,
      idempotencyKey: "issue-idem",
    });
    const second = await issueAssociationCode(db, {
      studentId: student.studentId,
      idempotencyKey: "issue-idem",
    });

    expect(second.idempotentReplay).toBe(true);
    expect(second.associationCodeId).toBe(first.associationCodeId);

    const rows = await db
      .select()
      .from(studentAssociationCodes)
      .where(eq(studentAssociationCodes.issueIdempotencyKey, "issue-idem"));
    expect(rows).toHaveLength(1);
  });

  it("rejects unverified parent relationship requests", async () => {
    const { adminId } = await bootstrapAdmin(
      db,
      `admin-unverified-${crypto.randomUUID()}@test.local`,
    );
    const parentEmail = `unverified-${crypto.randomUUID()}@test.local`;
    const invite = await createInvitation(db, {
      adminId,
      targetRole: "parent",
      idempotencyKey: `invite-${parentEmail}`,
    });

    await registerParent(db, {
      invitationCode: invite.codePlaintext,
      displayName: "Unverified Parent",
      email: parentEmail,
      password: "ParentPass123!Parent",
      idempotencyKey: `register-${parentEmail}`,
    });

    const [parent] = await db.select().from(users).where(eq(users.email, parentEmail));
    if (!parent) {
      throw new Error("Expected unverified parent");
    }

    const student = await seedStudentUser(db, {
      username: `student_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });
    const code = await issueAssociationCode(db, {
      studentId: student.studentId,
      idempotencyKey: "issue-unverified",
    });

    await expect(
      createRelationshipRequest(db, {
        parentId: parent.id,
        associationCodePlaintext: code.codePlaintext,
        idempotencyKey: "req-unverified",
      }),
    ).rejects.toMatchObject({ code: "CONTACT_NOT_VERIFIED" });
  });

  it("invalidates pre-acceptance parent sessions when relationship is accepted", async () => {
    const parentEmail = `parent-epoch-${crypto.randomUUID()}@test.local`;
    const parentPassword = "ParentPass123!Parent";
    const { parentId } = await bootstrapVerifiedParentWithInvite(db, parentEmail);
    const student = await seedStudentUser(db, {
      username: `student_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });

    const loginResult = await login(db, {
      identifier: parentEmail,
      password: parentPassword,
      idempotencyKey: "login-before-accept",
    });

    const code = await issueAssociationCode(db, {
      studentId: student.studentId,
      idempotencyKey: "issue-epoch",
    });
    const pending = await createRelationshipRequest(db, {
      parentId,
      associationCodePlaintext: code.codePlaintext,
      idempotencyKey: "req-epoch",
    });

    await acceptRelationshipRequest(db, {
      studentId: student.studentId,
      requestId: pending.requestId,
      idempotencyKey: "accept-epoch",
    });

    const validated = await validateSession(db, loginResult.sessionId);
    expect(validated).toBeNull();
  });
});
