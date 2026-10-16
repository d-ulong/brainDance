import type { TestDb } from "./db";
import { login } from "@/modules/identity/login.service";
import { seedAdminUser } from "@/modules/identity/seed-admin";
import { totpForStep } from "@/modules/identity/totp";
import { and, eq, gt, isNotNull } from "drizzle-orm";
import { sessions } from "@/db/schema";
import { createLucia } from "@/lib/lucia";

export async function bootstrapAdmin(db: TestDb, email = "admin@test.local") {
  const password = "AdminPass123!AdminPass";
  const adminId = await seedAdminUser(db, { email, password, displayName: "Test Admin" });
  const [existing] = await db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, adminId),
        isNotNull(sessions.mfaVerifiedAt),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (existing) {
    const cookie = createLucia(db).createSessionCookie(existing.id);
    return {
      adminId,
      email,
      password,
      session: {
        userId: adminId,
        sessionId: existing.id,
        contactVerified: true,
        sessionCookie: {
          name: cookie.name,
          value: cookie.value,
          attributes: {
            secure: cookie.attributes.secure ?? false,
            path: cookie.attributes.path ?? "/",
            httpOnly: cookie.attributes.httpOnly ?? true,
            sameSite: cookie.attributes.sameSite ?? "lax",
          },
        },
      },
    };
  }
  // Test fixture only: production never provisions credentials from application code.
  const secret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
  const configured = JSON.parse(process.env.ADMIN_TOTP_SECRETS ?? "{}") as Record<string, string>;
  process.env.ADMIN_TOTP_SECRETS = JSON.stringify({ ...configured, [adminId]: secret });
  const session = await login(db, {
    identifier: email,
    password,
    totpCode: totpForStep(secret, Math.floor(Date.now() / 30_000)),
    idempotencyKey: `login-admin:${email}`,
  });
  return { adminId, email, password, session };
}

export async function createVerifiedParent(
  db: TestDb,
  input: {
    email: string;
    password: string;
    invitationCode: string;
    displayName?: string;
  },
) {
  const { registerParent } = await import("@/modules/identity/registration.service");
  const { issueContactVerification, verifyContact } =
    await import("@/modules/identity/verification.service");

  const registered = await registerParent(db, {
    invitationCode: input.invitationCode,
    displayName: input.displayName ?? "Test Parent",
    email: input.email,
    password: input.password,
    idempotencyKey: `register:${input.email}`,
  });

  const issued = await issueContactVerification(db, {
    userId: registered.userId,
    idempotencyKey: `issue:${input.email}`,
  });

  if (!issued.devOtpPlaintext) {
    throw new Error("Expected dev OTP plaintext in test environment");
  }

  await verifyContact(db, {
    userId: registered.userId,
    otp: issued.devOtpPlaintext,
    idempotencyKey: `verify:${input.email}`,
  });

  return registered;
}
