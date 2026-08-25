import { eq } from "drizzle-orm";

import type { Database } from "@/db";
import { auditEvents, users } from "@/db/schema";
import { appendAuditEvent } from "@/modules/audit/append-audit-event";
import { hashPassword, verifyPassword } from "@/lib/crypto";
import { createLucia } from "@/lib/lucia";
import { IdentityError } from "@/modules/identity/errors";

export type ChangePasswordInput = {
  userId: string;
  currentSessionId: string;
  currentPassword: string;
  newPassword: string;
  idempotencyKey: string;
  requestId?: string;
};

export type ChangePasswordResult = {
  userId: string;
  mustChangePassword: false;
  idempotentReplay: boolean;
  sessionCookie: {
    name: string;
    value: string;
    attributes: {
      secure: boolean;
      path: string;
      httpOnly: boolean;
      sameSite: "lax" | "strict" | "none";
    };
  };
};

function auditKeyForChangePassword(userId: string, idempotencyKey: string) {
  return `audit:change-password:${userId}:${idempotencyKey}`;
}

async function createFreshSessionCookie(db: Database, userId: string) {
  const lucia = createLucia(db);
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) {
    throw new IdentityError("USER_NOT_FOUND", "User not found");
  }

  await lucia.invalidateUserSessions(userId);
  const session = await lucia.createSession(userId, {
    authorizationEpoch: user.authorizationEpoch,
  });
  const sessionCookie = lucia.createSessionCookie(session.id);

  return {
    name: sessionCookie.name,
    value: sessionCookie.value,
    attributes: {
      secure: sessionCookie.attributes.secure ?? false,
      path: sessionCookie.attributes.path ?? "/",
      httpOnly: sessionCookie.attributes.httpOnly ?? true,
      sameSite: sessionCookie.attributes.sameSite ?? "lax",
    },
  };
}

export async function changePassword(
  db: Database,
  input: ChangePasswordInput,
): Promise<ChangePasswordResult> {
  const auditKey = auditKeyForChangePassword(input.userId, input.idempotencyKey);
  const [existingAudit] = await db
    .select({ id: auditEvents.id })
    .from(auditEvents)
    .where(eq(auditEvents.idempotencyKey, auditKey))
    .limit(1);

  if (existingAudit) {
    return {
      userId: input.userId,
      mustChangePassword: false,
      idempotentReplay: true,
      sessionCookie: await createFreshSessionCookie(db, input.userId),
    };
  }

  if (input.newPassword.length < 12) {
    throw new IdentityError("VALIDATION_ERROR", "New password must be at least 12 characters");
  }

  if (input.currentPassword === input.newPassword) {
    throw new IdentityError("VALIDATION_ERROR", "New password must differ from current password");
  }

  const [user] = await db.select().from(users).where(eq(users.id, input.userId)).limit(1);
  if (!user) {
    throw new IdentityError("USER_NOT_FOUND", "User not found");
  }
  if (user.role !== "student") {
    throw new IdentityError("FORBIDDEN", "Only students can use this password change flow");
  }

  const currentValid = await verifyPassword(input.currentPassword, user.passwordHash);
  if (!currentValid) {
    throw new IdentityError("INVALID_CREDENTIALS", "Current password is incorrect");
  }

  const passwordHash = await hashPassword(input.newPassword);
  const changedAt = new Date();
  let applied = false;

  await db.transaction(async (tx) => {
    const [auditInTx] = await tx
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(eq(auditEvents.idempotencyKey, auditKey))
      .limit(1);

    if (auditInTx) {
      return;
    }

    await tx
      .update(users)
      .set({
        passwordHash,
        mustChangePassword: false,
        passwordChangedAt: changedAt,
        authorizationEpoch: user.authorizationEpoch + 1,
        updatedAt: changedAt,
      })
      .where(eq(users.id, input.userId));

    await appendAuditEvent(tx, {
      actorId: input.userId,
      action: "auth.password_changed",
      resourceType: "user",
      resourceId: input.userId,
      requestId: input.requestId,
      idempotencyKey: auditKey,
    });

    applied = true;
  });

  return {
    userId: input.userId,
    mustChangePassword: false,
    idempotentReplay: !applied,
    sessionCookie: await createFreshSessionCookie(db, input.userId),
  };
}
