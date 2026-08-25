import { config } from "dotenv";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { auditEvents, invitations, users } from "@/db/schema";
import {
  createInvitation,
  revokeInvitation,
} from "@/modules/identity/invitation.service";
import { login } from "@/modules/identity/login.service";
import { registerParent } from "@/modules/identity/registration.service";
import {
  issueContactVerification,
  verifyContact,
} from "@/modules/identity/verification.service";
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

describe.skipIf(!hasDb)("identity module", () => {
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

  it("creates invitation with role/expiry/usage and stores only hash", async () => {
    const { adminId } = await bootstrapAdmin(db);

    const created = await createInvitation(db, {
      adminId,
      targetRole: "parent",
      maxUses: 2,
      idempotencyKey: "inv-create-1",
    });

    expect(created.codePlaintext.length).toBeGreaterThan(10);
    expect(created.idempotentReplay).toBe(false);

    const [row] = await db.select().from(invitations).where(eq(invitations.id, created.invitationId));
    expect(row?.usedCount).toBe(0);
    expect(row?.targetRole).toBe("parent");
    expect(row?.codeHash).not.toContain(created.codePlaintext);

    const audit = await db.select().from(auditEvents);
    const serialized = JSON.stringify(audit);
    expect(serialized).not.toContain(created.codePlaintext);
  });

  it("rejects expired, revoked, exhausted, and role-mismatched invitation codes", async () => {
    const { adminId } = await bootstrapAdmin(db);

    const expired = await createInvitation(db, {
      adminId,
      targetRole: "parent",
      expiresAt: new Date(Date.now() - 60_000),
      idempotencyKey: "inv-expired",
    });

    await expect(
      registerParent(db, {
        invitationCode: expired.codePlaintext,
        displayName: "Parent",
        email: "parent1@test.local",
        password: "ParentPass123!Parent",
        idempotencyKey: "reg-expired",
      }),
    ).rejects.toMatchObject({ code: "INVITATION_EXPIRED" });

    const revokable = await createInvitation(db, {
      adminId,
      targetRole: "parent",
      idempotencyKey: "inv-revoke",
    });

    await revokeInvitation(db, {
      adminId,
      invitationId: revokable.invitationId,
      idempotencyKey: "revoke-1",
    });

    await expect(
      registerParent(db, {
        invitationCode: revokable.codePlaintext,
        displayName: "Parent",
        email: "parent2@test.local",
        password: "ParentPass123!Parent",
        idempotencyKey: "reg-revoked",
      }),
    ).rejects.toMatchObject({ code: "INVITATION_REVOKED" });

    const singleUse = await createInvitation(db, {
      adminId,
      targetRole: "parent",
      maxUses: 1,
      idempotencyKey: "inv-single",
    });

    await registerParent(db, {
      invitationCode: singleUse.codePlaintext,
      displayName: "Parent",
      email: "parent3@test.local",
      password: "ParentPass123!Parent",
      idempotencyKey: "reg-single-1",
    });

    await expect(
      registerParent(db, {
        invitationCode: singleUse.codePlaintext,
        displayName: "Parent Two",
        email: "parent4@test.local",
        password: "ParentPass123!Parent",
        idempotencyKey: "reg-single-2",
      }),
    ).rejects.toMatchObject({ code: "INVITATION_EXHAUSTED" });

    const studentInvite = await createInvitation(db, {
      adminId,
      targetRole: "student",
      idempotencyKey: "inv-student",
    });

    await expect(
      registerParent(db, {
        invitationCode: studentInvite.codePlaintext,
        displayName: "Parent",
        email: "parent5@test.local",
        password: "ParentPass123!Parent",
        idempotencyKey: "reg-role",
      }),
    ).rejects.toMatchObject({ code: "INVITATION_ROLE_MISMATCH" });
  });

  it("registers parent idempotently without double-consuming invitation", async () => {
    const { adminId } = await bootstrapAdmin(db);
    const invite = await createInvitation(db, {
      adminId,
      targetRole: "parent",
      idempotencyKey: "inv-idem",
    });

    const first = await registerParent(db, {
      invitationCode: invite.codePlaintext,
      displayName: "Parent",
      email: "parent-idem@test.local",
      password: "ParentPass123!Parent",
      idempotencyKey: "reg-idem",
    });

    const second = await registerParent(db, {
      invitationCode: invite.codePlaintext,
      displayName: "Parent",
      email: "parent-idem@test.local",
      password: "ParentPass123!Parent",
      idempotencyKey: "reg-idem",
    });

    expect(second.idempotentReplay).toBe(true);
    expect(second.userId).toBe(first.userId);

    const [invitationRow] = await db
      .select()
      .from(invitations)
      .where(eq(invitations.id, invite.invitationId));
    expect(invitationRow?.usedCount).toBe(1);
  });

  it("verifies contact and allows login only after verification flag is set", async () => {
    const { adminId } = await bootstrapAdmin(db);
    const invite = await createInvitation(db, {
      adminId,
      targetRole: "parent",
      idempotencyKey: "inv-verify",
    });

    const registered = await registerParent(db, {
      invitationCode: invite.codePlaintext,
      displayName: "Parent",
      email: "verified-parent@test.local",
      password: "ParentPass123!Parent",
      idempotencyKey: "reg-verify",
    });

    const beforeVerify = await login(db, {
      identifier: "verified-parent@test.local",
      password: "ParentPass123!Parent",
      idempotencyKey: "login-before-verify",
    });
    expect(beforeVerify.contactVerified).toBe(false);

    const issued = await issueContactVerification(db, {
      userId: registered.userId,
      idempotencyKey: "issue-verify",
    });
    expect(issued.devOtpPlaintext).toBeTruthy();

    await verifyContact(db, {
      userId: registered.userId,
      otp: issued.devOtpPlaintext!,
      idempotencyKey: "verify-contact",
    });

    const afterVerify = await login(db, {
      identifier: "verified-parent@test.local",
      password: "ParentPass123!Parent",
      idempotencyKey: "login-after-verify",
    });
    expect(afterVerify.contactVerified).toBe(true);

    const [user] = await db.select().from(users).where(eq(users.id, registered.userId));
    expect(user?.contactVerifiedAt).not.toBeNull();
    expect(user?.status).toBe("active");
  });

  it("locks account after repeated failed logins and writes security audit", async () => {
    const { adminId } = await bootstrapAdmin(db);
    const invite = await createInvitation(db, {
      adminId,
      targetRole: "parent",
      idempotencyKey: "inv-lock",
    });

    await registerParent(db, {
      invitationCode: invite.codePlaintext,
      displayName: "Parent",
      email: "lock-parent@test.local",
      password: "ParentPass123!Parent",
      idempotencyKey: "reg-lock",
    });

    for (let i = 0; i < 5; i += 1) {
      await expect(
        login(db, {
          identifier: "lock-parent@test.local",
          password: "WrongPassword!",
          idempotencyKey: `fail-${i}`,
        }),
      ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    }

    await expect(
      login(db, {
        identifier: "lock-parent@test.local",
        password: "ParentPass123!Parent",
        idempotencyKey: "login-while-locked",
      }),
    ).rejects.toMatchObject({ code: "ACCOUNT_LOCKED" });

    const audit = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "account.locked"));
    expect(audit.length).toBeGreaterThan(0);

    const securityEvents = await db.execute(sql`
      SELECT event_type FROM login_security_events WHERE account_key = 'lock-parent@test.local'
    `);
    expect(securityEvents.length).toBeGreaterThanOrEqual(5);
  });

  it("create invitation idempotency returns stable invitation without duplicate rows", async () => {
    const { adminId } = await bootstrapAdmin(db);

    const first = await createInvitation(db, {
      adminId,
      targetRole: "parent",
      idempotencyKey: "inv-idem-create",
    });
    const second = await createInvitation(db, {
      adminId,
      targetRole: "parent",
      idempotencyKey: "inv-idem-create",
    });

    expect(second.idempotentReplay).toBe(true);
    expect(second.invitationId).toBe(first.invitationId);

    const rows = await db.select().from(invitations);
    expect(rows.filter((row: (typeof rows)[number]) => row.creationIdempotencyKey === "inv-idem-create")).toHaveLength(1);
  });
});
