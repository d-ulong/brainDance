import { and, desc, eq, gt, sql } from "drizzle-orm";

import type { Database } from "@/db";
import { loginSecurityEvents, users } from "@/db/schema";
import { appendAuditEvent } from "@/modules/audit/append-audit-event";
import { normalizeAccountKey, verifyPassword } from "@/lib/crypto";
import { createLucia } from "@/lib/lucia";
import { loginPolicy } from "@/modules/identity/login-policy";
import { IdentityError } from "@/modules/identity/errors";

export type LoginInput = {
  identifier: string;
  password: string;
  ipAddress?: string;
  idempotencyKey?: string;
  requestId?: string;
};

export type LoginResult = {
  userId: string;
  sessionId: string;
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
  contactVerified: boolean;
};

export type LogoutInput = {
  sessionId: string;
  actorId?: string;
  idempotencyKey?: string;
  requestId?: string;
};

export async function findUserByIdentifier(db: Database, identifier: string) {
  const normalized = normalizeAccountKey(identifier);
  const [byEmail] = await db.select().from(users).where(eq(users.email, normalized)).limit(1);
  if (byEmail) return byEmail;

  const [byPhone] = await db
    .select()
    .from(users)
    .where(eq(users.phone, identifier.trim()))
    .limit(1);
  if (byPhone) return byPhone;

  const [byUsername] = await db
    .select()
    .from(users)
    .where(eq(users.username, identifier.trim()))
    .limit(1);
  return byUsername ?? null;
}

async function countRecentFailures(db: Database, accountKey: string): Promise<number> {
  const since = new Date(Date.now() - loginPolicy().lockDurationMs);
  const events = await db
    .select({
      eventType: loginSecurityEvents.eventType,
      occurredAt: loginSecurityEvents.occurredAt,
    })
    .from(loginSecurityEvents)
    .where(
      and(
        eq(loginSecurityEvents.accountKey, accountKey),
        gt(loginSecurityEvents.occurredAt, since),
      ),
    )
    .orderBy(desc(loginSecurityEvents.occurredAt));

  let failures = 0;
  for (const event of events) {
    if (event.eventType === "login_success" || event.eventType === "account_unlocked") {
      break;
    }
    if (event.eventType === "login_failed") {
      failures += 1;
    }
  }
  return failures;
}

async function recordSecurityEvent(
  db: Database,
  input: {
    accountKey: string;
    eventType: string;
    ipAddress?: string;
    idempotencyKey?: string;
  },
): Promise<void> {
  if (input.idempotencyKey) {
    const [existing] = await db
      .select({ id: loginSecurityEvents.id })
      .from(loginSecurityEvents)
      .where(eq(loginSecurityEvents.idempotencyKey, input.idempotencyKey))
      .limit(1);
    if (existing) {
      return;
    }
  }

  await db.insert(loginSecurityEvents).values({
    accountKey: input.accountKey,
    eventType: input.eventType,
    ipAddress: input.ipAddress,
    idempotencyKey: input.idempotencyKey,
    occurredAt: sql`clock_timestamp()`,
  });
}

export async function login(db: Database, input: LoginInput): Promise<LoginResult> {
  // Commit failure accounting too; serialize a known account's checks and counters.
  const outcome = await db.transaction(async (tx) => {
    const found = await findUserByIdentifier(tx, input.identifier);
    if (found) await tx.execute(sql`SELECT id FROM users WHERE id = ${found.id} FOR UPDATE`);
    try {
      return await loginInTransaction(tx, input);
    } catch (error) {
      if (error instanceof IdentityError) return error;
      throw error;
    }
  });
  if (outcome instanceof IdentityError) throw outcome;
  return outcome;
}

async function loginInTransaction(db: Database, input: LoginInput): Promise<LoginResult> {
  const user = await findUserByIdentifier(db, input.identifier);
  const accountKey = normalizeAccountKey(input.identifier);

  if (!user) {
    await recordSecurityEvent(db, {
      accountKey,
      eventType: "login_failed",
      ipAddress: input.ipAddress,
      idempotencyKey: input.idempotencyKey ? `fail:${input.idempotencyKey}` : undefined,
    });
    throw new IdentityError("INVALID_CREDENTIALS", "Invalid credentials");
  }

  if (user.status === "disabled") {
    throw new IdentityError("FORBIDDEN", "Account is disabled");
  }

  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    const seconds = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000);
    throw new IdentityError(
      "ACCOUNT_LOCKED",
      `尝试次数较多，请在 ${seconds} 秒后重试。等待期间无需重复点击。`,
    );
  }

  if (user.status === "locked") {
    await db
      .update(users)
      .set({
        status:
          user.role !== "parent" || user.contactVerifiedAt ? "active" : "pending_verification",
        lockedUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));
    await recordSecurityEvent(db, { accountKey, eventType: "account_unlocked" });
    await appendAuditEvent(db, {
      actorId: user.id,
      action: "account.unlocked",
      resourceType: "user",
      resourceId: user.id,
      reasonCode: "lock_expired",
      requestId: input.requestId,
    });
  }

  const passwordValid = await verifyPassword(input.password, user.passwordHash);
  if (!passwordValid) {
    await recordSecurityEvent(db, {
      accountKey,
      eventType: "login_failed",
      ipAddress: input.ipAddress,
      idempotencyKey: input.idempotencyKey ? `fail:${input.idempotencyKey}` : undefined,
    });

    const failures = await countRecentFailures(db, accountKey);
    if (failures >= loginPolicy().maxFailures) {
      const lockedUntil = new Date(Date.now() + loginPolicy().lockDurationMs);
      await db
        .update(users)
        .set({ lockedUntil, status: "locked", updatedAt: new Date() })
        .where(eq(users.id, user.id));

      await recordSecurityEvent(db, {
        accountKey,
        eventType: "account_locked",
        ipAddress: input.ipAddress,
        idempotencyKey: input.idempotencyKey ? `lock:${input.idempotencyKey}` : undefined,
      });

      await appendAuditEvent(db, {
        actorId: user.id,
        action: "account.locked",
        resourceType: "user",
        resourceId: user.id,
        reasonCode: "login_failures",
        requestId: input.requestId,
        idempotencyKey: input.idempotencyKey ? `audit:lock:${input.idempotencyKey}` : undefined,
        metadata: { failureCount: failures },
      });
    }

    throw new IdentityError(
      "INVALID_CREDENTIALS",
      failures >= loginPolicy().maxFailures
        ? `账号或密码不正确，已暂时锁定 ${Math.ceil(loginPolicy().lockDurationMs / 1000)} 秒。`
        : "账号或密码不正确，请检查输入或点击小眼睛核对密码。",
    );
  }

  // Frozen students must not obtain a generic session (P2 freeze contract).
  // They re-authenticate through the narrow deletion-management capability flow.
  // Verified only after the password matches to avoid account-state enumeration.
  if (user.role === "student") {
    const { findActiveStudentAccountFreeze } =
      await import("@/modules/data-lifecycle/freeze-guard.service");
    const freeze = await findActiveStudentAccountFreeze(db, user.id);
    if (freeze) {
      throw new IdentityError("FORBIDDEN", "Account is frozen for deletion");
    }
  }

  await recordSecurityEvent(db, {
    accountKey,
    eventType: "login_success",
    ipAddress: input.ipAddress,
    idempotencyKey: input.idempotencyKey ? `success:${input.idempotencyKey}` : undefined,
  });

  const lucia = createLucia(db);
  const session = await lucia.createSession(user.id, {
    authorizationEpoch: user.authorizationEpoch,
  });
  const sessionCookie = lucia.createSessionCookie(session.id);

  await appendAuditEvent(db, {
    actorId: user.id,
    action: "auth.login",
    resourceType: "session",
    resourceId: null,
    requestId: input.requestId,
    idempotencyKey: input.idempotencyKey ? `audit:login:${input.idempotencyKey}` : undefined,
  });

  return {
    userId: user.id,
    sessionId: session.id,
    sessionCookie: {
      name: sessionCookie.name,
      value: sessionCookie.value,
      attributes: {
        secure: sessionCookie.attributes.secure ?? false,
        path: sessionCookie.attributes.path ?? "/",
        httpOnly: sessionCookie.attributes.httpOnly ?? true,
        sameSite: sessionCookie.attributes.sameSite ?? "lax",
      },
    },
    contactVerified: user.role !== "parent" || user.contactVerifiedAt !== null,
  };
}

export async function logout(db: Database, input: LogoutInput): Promise<void> {
  const lucia = createLucia(db);
  await lucia.invalidateSession(input.sessionId);

  await appendAuditEvent(db, {
    actorId: input.actorId,
    action: "auth.logout",
    resourceType: "session",
    resourceId: null,
    requestId: input.requestId,
    idempotencyKey: input.idempotencyKey ? `audit:logout:${input.idempotencyKey}` : undefined,
  });
}

export async function validateSession(db: Database, sessionId: string) {
  const lucia = createLucia(db);
  const result = await lucia.validateSession(sessionId);
  if (!result.session || !result.user) {
    return null;
  }

  if (result.session.authorizationEpoch !== result.user.authorizationEpoch) {
    await lucia.invalidateSession(sessionId);
    return null;
  }

  // Fail-closed for frozen students (P2 freeze contract): no generic session may
  // validate while an account deletion freeze is active. Deletion cancel/confirm
  // use the narrow deletion-management capability instead of a session.
  if (result.user.role === "student") {
    const { findActiveStudentAccountFreeze } =
      await import("@/modules/data-lifecycle/freeze-guard.service");
    const freeze = await findActiveStudentAccountFreeze(db, result.user.id);
    if (freeze) {
      await lucia.invalidateSession(sessionId);
      return null;
    }
  }

  return result;
}
