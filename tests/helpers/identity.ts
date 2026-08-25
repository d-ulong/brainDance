import type { TestDb } from "./db";
import { login } from "@/modules/identity/login.service";
import { seedAdminUser } from "@/modules/identity/seed-admin";

export async function bootstrapAdmin(db: TestDb, email = "admin@test.local") {
  const password = "AdminPass123!AdminPass";
  const adminId = await seedAdminUser(db, { email, password, displayName: "Test Admin" });
  const session = await login(db, {
    identifier: email,
    password,
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
