import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";

import type { Database } from "@/db";
import { contactVerificationCodes, users } from "@/db/schema";
import { appendAuditEvent } from "@/modules/audit/append-audit-event";
import { generateOtpPlaintext, hashOtp } from "@/lib/crypto";
import { OTP_TTL_MS } from "@/modules/identity/constants";
import { IdentityError } from "@/modules/identity/errors";
import {
  deliverVerificationCode,
  mayExposeDevOtpPlaintext,
} from "@/modules/identity/verification-delivery";

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
      if (existing.userId !== input.userId)
        throw new IdentityError("FORBIDDEN", "请求标识不可用于其他账号");
      if (existing.deliveryStatus === "failed" || existing.deliveryStatus === "pending")
        throw new IdentityError("DELIVERY_UNAVAILABLE", "验证码未成功发送，请重新获取");
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

  const created = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM users WHERE id = ${user.id}::uuid FOR UPDATE`);
    const [duplicate] = await tx
      .select()
      .from(contactVerificationCodes)
      .where(eq(contactVerificationCodes.issueIdempotencyKey, input.idempotencyKey))
      .limit(1);
    if (duplicate) throw new IdentityError("DELIVERY_UNAVAILABLE", "请求正在发送，请稍后重新获取");
    const recent = await tx
      .select({ id: contactVerificationCodes.id })
      .from(contactVerificationCodes)
      .where(
        and(
          eq(contactVerificationCodes.userId, user.id),
          gt(contactVerificationCodes.createdAt, new Date(Date.now() - 60_000)),
        ),
      );
    if (recent.length >= 3) throw new IdentityError("RATE_LIMITED", "验证码获取频繁，请稍后重试");
    const [row] = await tx
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
    if (!row) throw new Error("Failed to issue verification code");
    await appendAuditEvent(tx, {
      actorId: user.id,
      action: "contact.verification_issued",
      resourceType: "user",
      resourceId: user.id,
      requestId: input.requestId,
      idempotencyKey: `audit:issue-otp:${input.idempotencyKey}`,
      metadata: { contactType },
    });
    return row;
  });

  // External delivery is outside database transactions and never enters audit/log metadata.
  try {
    const deliveryStatus = await deliverVerificationCode({
      verificationId: created.id,
      contactType,
      contactValue,
      code: otpPlaintext,
      expiresAt,
    });
    await db
      .update(contactVerificationCodes)
      .set({ deliveryStatus })
      .where(eq(contactVerificationCodes.id, created.id));
  } catch (error) {
    await db
      .update(contactVerificationCodes)
      .set({ deliveryStatus: "failed" })
      .where(eq(contactVerificationCodes.id, created.id));
    throw error;
  }

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
  const outcome = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM users WHERE id = ${input.userId}::uuid FOR UPDATE`);
    const [user] = await tx.select().from(users).where(eq(users.id, input.userId)).limit(1);
    if (!user) throw new IdentityError("USER_NOT_FOUND", "User not found");
    if (user.contactVerifiedAt)
      return { userId: user.id, verifiedAt: user.contactVerifiedAt, idempotentReplay: true };
    const now = new Date();
    const [code] = await tx
      .select()
      .from(contactVerificationCodes)
      .where(
        and(
          eq(contactVerificationCodes.userId, input.userId),
          isNull(contactVerificationCodes.consumedAt),
          gt(contactVerificationCodes.expiresAt, now),
        ),
      )
      .orderBy(desc(contactVerificationCodes.createdAt))
      .limit(1);
    if (!code || !["sent", "development"].includes(code.deliveryStatus) || code.attemptCount >= 5) {
      return new IdentityError("VERIFICATION_INVALID", "Verification code is invalid or expired");
    }
    const attempts = code.attemptCount + 1;
    await tx
      .update(contactVerificationCodes)
      .set({ attemptCount: attempts })
      .where(eq(contactVerificationCodes.id, code.id));
    if (code.codeHash !== hashOtp(input.otp))
      return new IdentityError("VERIFICATION_INVALID", "Verification code is invalid or expired");
    await tx
      .update(contactVerificationCodes)
      .set({ consumedAt: now, verifyIdempotencyKey: input.idempotencyKey })
      .where(eq(contactVerificationCodes.id, code.id));
    await tx
      .update(users)
      .set({ contactVerifiedAt: now, status: "active", updatedAt: now })
      .where(eq(users.id, user.id));
    await appendAuditEvent(tx, {
      actorId: user.id,
      action: "contact.verified",
      resourceType: "user",
      resourceId: user.id,
      requestId: input.requestId,
      idempotencyKey: `audit:verify:${user.id}:${input.idempotencyKey}`,
    });
    return { userId: user.id, verifiedAt: now, idempotentReplay: false };
  });
  // Incorrect guesses are committed; throwing inside the transaction would undo the counter.
  if (outcome instanceof IdentityError) throw outcome;
  return outcome;
}

export function isContactVerified(user: { contactVerifiedAt: Date | null; role: string }): boolean {
  if (user.role === "admin") {
    return true;
  }
  return user.contactVerifiedAt !== null;
}
