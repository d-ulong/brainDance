import { config } from "dotenv";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { auditEvents } from "@/db/schema";
import { issueAssociationCode } from "@/modules/family-access/association-code.service";
import {
  acceptRelationshipRequest,
  createRelationshipRequest,
} from "@/modules/family-access/relationship-request.service";
import { createInvitation } from "@/modules/identity/invitation.service";
import { registerParent } from "@/modules/identity/registration.service";
import {
  issueContactVerification,
  verifyContact,
} from "@/modules/identity/verification.service";
import { completeReactionSession } from "../../helpers/training";
import { seedStudentUser } from "../../helpers/family-access";
import { bootstrapAdmin } from "../../helpers/identity";
import {
  closeTestDb,
  getTestDb,
  migrateTestDb,
  resetIdentityTables,
} from "../../helpers/db";

config({ path: ".env.local" });
config({ path: ".env" });

const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);

const REQUIRED_ACTIONS = [
  "invitation.created",
  "invitation.redeemed",
  "association_code.issued",
  "relationship_request.created",
  "relationship.accepted",
  "guardian_consent.recorded",
  "training_session.completed",
  "account.locked",
] as const;

describe.skipIf(!hasDb)("audit coverage", () => {
  const db = getTestDb();

  beforeAll(async () => {
    process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";
    await migrateTestDb();
  });

  beforeEach(async () => {
    await resetIdentityTables(db);
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("records required M1 actions without sensitive plaintext", async () => {
    const { adminId } = await bootstrapAdmin(db);
    const invite = await createInvitation(db, {
      adminId,
      targetRole: "parent",
      idempotencyKey: "audit-invite",
    });

    const parentEmail = `audit-parent-${crypto.randomUUID()}@test.local`;
    const registered = await registerParent(db, {
      invitationCode: invite.codePlaintext,
      displayName: "Audit Parent",
      email: parentEmail,
      password: "ParentPass123!Parent",
      idempotencyKey: "audit-register",
    });

    const issued = await issueContactVerification(db, {
      userId: registered.userId,
      idempotencyKey: "audit-issue-otp",
    });
    if (!issued.devOtpPlaintext) {
      throw new Error("Expected dev OTP");
    }
    await verifyContact(db, {
      userId: registered.userId,
      otp: issued.devOtpPlaintext,
      idempotencyKey: "audit-verify",
    });

    const student = await seedStudentUser(db, {
      username: `audit_student_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });

    const code = await issueAssociationCode(db, {
      studentId: student.studentId,
      idempotencyKey: "audit-code",
    });
    const pending = await createRelationshipRequest(db, {
      parentId: registered.userId,
      associationCodePlaintext: code.codePlaintext,
      idempotencyKey: "audit-req",
    });
    await acceptRelationshipRequest(db, {
      studentId: student.studentId,
      requestId: pending.requestId,
      idempotencyKey: "audit-accept",
    });

    await completeReactionSession(db, student.studentId, {
      startIdempotencyKey: "audit-training-start",
      submitIdempotencyKey: "audit-training-submit",
    });

    const rows = await db.select().from(auditEvents);
    const actions = new Set(rows.map((row) => row.action));
    for (const action of REQUIRED_ACTIONS.filter((a) => a !== "account.locked")) {
      expect(actions.has(action)).toBe(true);
    }

    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain(invite.codePlaintext);
    expect(serialized).not.toContain(code.codePlaintext);
    expect(serialized).not.toContain(issued.devOtpPlaintext);
    expect(serialized).not.toContain("ParentPass123!Parent");
  });
});
