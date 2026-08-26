import { and, eq, gt, isNull } from "drizzle-orm";

import type { Database } from "@/db";
import { contactVerificationCodes, users } from "@/db/schema";
import { appendAuditEvent } from "@/modules/audit/append-audit-event";
import { generateOtpPlaintext, hashOtp } from "@/lib/crypto";
import { OTP_TTL_MS } from "@/modules/identity/constants";
import { IdentityError } from "@/modules/identity/errors";

export type IssueContactVerificationInput = {
  userId: string;
  idempotencyKey: string;
  requestId?: string;
};

export type IssueContactVerificationResult = {
  verificationId: string;
  /** Dev/test only channel payload; never log in production pipelines. */
  devOtpPlaintext?: string;
  expiresAt: Date;
  idempotentReplay: boolean;
};

export type VerifyContactInput = {
  userId: string;
  otp: string;
  idempotencyKey: string;
  requestId?: string;
};

export type VerifyContactResult = {
  userId: string;
  verifiedAt: Date;
  idempotentReplay: boolean;
};

function mayExposeDevOtpPlaintext(): boolean {
  return process.env.EXPOSE_DEV_OTP === "true" || process.env.NODE_ENV !== "production";
}

export async function issueContactVerification(
  db: Database,
  input: IssueContactVerificationInput,
): Promise<IssueContactVerificationResult> {
  if (input.idempotencyKey) {
    const [existing] = await db
      .select()
      .from(contactVerificationCodes)
      .where(eq(contactVerificationCodes.issueIdempotencyKey, input.idempotencyKey))
      .limit(1);

    if (existing) {
      return {
        verificationId: existing.id,
        expiresAt: existing.expiresAt,
        idempotentReplay: true,
      };
    }
  }

  const [user] = await db.select().from(users).where(eq(users.id, input.userId)).limit(1);
  if (!user) {
    throw new IdentityError("USER_NOT_FOUND", "User not found");
  }

  const contactValue = user.email ?? user.phone;
  const contactType = user.email ? "email" : user.phone ? "phone" : null;
  if (!contactValue || !contactType) {
    throw new IdentityError("VALIDATION_ERROR", "User has no contact to verify");
  }

  if (user.contactVerifiedAt) {
    return {
      verificationId: user.id,
      expiresAt: user.contactVerifiedAt,
      idempotentReplay: true,
    };
  }

  const otpPlaintext = generateOtpPlaintext();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  const [created] = await db
    .insert(contactVerificationCodes)
    .values({
      userId: user.id,
      contactType,
      contactValue,
      codeHash: hashOtp(otpPlaintext),
      expiresAt,
      issueIdempotencyKey: input.idempotencyKey,
    })
    .returning();

  if (!created) {
    throw new Error("Failed to issue verification code");
  }

  await appendAuditEvent(db, {
    actorId: user.id,
    action: "contact.verification_issued",
    resourceType: "user",
    resourceId: user.id,
    requestId: input.requestId,
    idempotencyKey: `audit:issue-otp:${input.idempotencyKey}`,
    metadata: { contactType },
  });

  return {
    verificationId: created.id,
    devOtpPlaintext: mayExposeDevOtpPlaintext() ? otpPlaintext : undefined,
    expiresAt,
    idempotentReplay: false,
  };
}

export async function verifyContact(
  db: Database,
  input: VerifyContactInput,
): Promise<VerifyContactResult> {
  const [user] = await db.select().from(users).where(eq(users.id, input.userId)).limit(1);
  if (!user) {
    throw new IdentityError("USER_NOT_FOUND", "User not found");
  }

  if (user.contactVerifiedAt) {
    return {
      userId: user.id,
      verifiedAt: user.contactVerifiedAt,
      idempotentReplay: true,
    };
  }

  const [existingVerify] = await db
    .select()
    .from(contactVerificationCodes)
    .where(eq(contactVerificationCodes.verifyIdempotencyKey, input.idempotencyKey))
    .limit(1);

  if (existingVerify?.consumedAt) {
    return {
      userId: user.id,
      verifiedAt: existingVerify.consumedAt,
      idempotentReplay: true,
    };
  }

  const codeHash = hashOtp(input.otp);
  const now = new Date();

  const [activeCode] = await db
    .select()
    .from(contactVerificationCodes)
    .where(
      and(
        eq(contactVerificationCodes.userId, input.userId),
        eq(contactVerificationCodes.codeHash, codeHash),
        isNull(contactVerificationCodes.consumedAt),
        gt(contactVerificationCodes.expiresAt, now),
      ),
    )
    .limit(1);

  if (!activeCode) {
    throw new IdentityError("VERIFICATION_INVALID", "Verification code is invalid or expired");
  }

  const verifiedAt = new Date();

  await db.transaction(async (tx) => {
    await tx
      .update(contactVerificationCodes)
      .set({ consumedAt: verifiedAt, verifyIdempotencyKey: input.idempotencyKey })
      .where(eq(contactVerificationCodes.id, activeCode.id));

    await tx
      .update(users)
      .set({
        contactVerifiedAt: verifiedAt,
        status: "active",
        updatedAt: verifiedAt,
      })
      .where(eq(users.id, input.userId));

    await appendAuditEvent(tx, {
      actorId: input.userId,
      action: "contact.verified",
      resourceType: "user",
      resourceId: input.userId,
      requestId: input.requestId,
      idempotencyKey: `audit:verify:${input.idempotencyKey}`,
    });
  });

  return {
    userId: input.userId,
    verifiedAt,
    idempotentReplay: false,
  };
}

export function isContactVerified(user: { contactVerifiedAt: Date | null; role: string }): boolean {
  if (user.role === "admin") {
    return true;
  }
  return user.contactVerifiedAt !== null;
}
