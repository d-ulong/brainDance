import { eq, sql } from "drizzle-orm";
import type { Database } from "@/db";
import { auditEvents, sessions, users } from "@/db/schema";
import { appendAuditEvent } from "@/modules/audit/append-audit-event";
import { appendOutboxEvent } from "@/modules/outbox/append-outbox-event";
import { hashPassword, verifyPassword } from "@/lib/crypto";
import { createLucia } from "@/lib/lucia";
import { requireCredentialSession } from "@/modules/identity/credential-session";
import { IdentityError } from "@/modules/identity/errors";
import { assertProductPassword } from "@/modules/identity/password-policy";

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

export async function changePassword(
  db: Database,
  input: ChangePasswordInput,
): Promise<ChangePasswordResult> {
  assertProductPassword(input.newPassword);
  if (input.currentPassword === input.newPassword) {
    throw new IdentityError("VALIDATION_ERROR", "新密码不能与当前密码相同");
  }
  const key = `audit:change-password:${input.userId}:${input.idempotencyKey}`;
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM users WHERE id = ${input.userId}::uuid FOR UPDATE`);
    const { user, session } = await requireCredentialSession(
      tx,
      input.userId,
      input.currentSessionId,
    );
    const lucia = createLucia(tx);
    const [existing] = await tx
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.idempotencyKey, key))
      .limit(1);
    let cookie;
    if (existing) {
      // Replays never revive revoked sessions or mint another session.
      if (
        existing.metadata?.resultEpoch !== user.authorizationEpoch ||
        !(await verifyPassword(input.newPassword, user.passwordHash))
      ) {
        throw new IdentityError("IDEMPOTENCY_CONFLICT", "此改密操作已过期或参数不一致");
      }
      cookie = lucia.createSessionCookie(session.id);
    } else {
      if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
        throw new IdentityError("INVALID_CREDENTIALS", "当前密码不正确");
      }
      const now = new Date();
      const epoch = user.authorizationEpoch + 1;
      const passwordHash = await hashPassword(input.newPassword);
      await tx
        .update(users)
        .set({
          passwordHash,
          mustChangePassword: false,
          passwordChangedAt: now,
          authorizationEpoch: epoch,
          updatedAt: now,
        })
        .where(eq(users.id, user.id));
      await tx.delete(sessions).where(eq(sessions.userId, user.id));
      const renewed = await lucia.createSession(user.id, {
        authorizationEpoch: epoch,
        mfaVerifiedAt: session.mfaVerifiedAt,
      });
      cookie = lucia.createSessionCookie(renewed.id);
      await appendAuditEvent(tx, {
        actorId: user.id,
        action: "auth.password_changed",
        resourceType: "user",
        resourceId: user.id,
        requestId: input.requestId,
        idempotencyKey: key,
        metadata: { resultEpoch: epoch },
      });
      await appendOutboxEvent(tx, {
        aggregateType: "user",
        aggregateId: user.id,
        eventType: "auth.password_changed",
        dedupeKey: key,
        payload: { userId: user.id, authorizationEpoch: epoch },
      });
    }
    return {
      userId: input.userId,
      mustChangePassword: false,
      idempotentReplay: Boolean(existing),
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
    };
  });
}
