import { and, desc, eq, gt } from "drizzle-orm";

import type { Database } from "@/db";
import { loginSecurityEvents, users } from "@/db/schema";
import { appendAuditEvent } from "@/modules/audit/append-audit-event";
import { normalizeAccountKey, verifyPassword } from "@/lib/crypto";
import { createLucia } from "@/lib/lucia";
import { LOGIN_LOCK_DURATION_MS, MAX_LOGIN_FAILURES } from "@/modules/identity/constants";
import { IdentityError } from "@/modules/identity/errors";
import { isStudentAccountFrozen } from "@/modules/data-lifecycle/freeze-guard.service";

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

async function findUserByIdentifier(db: Database, identifier: string) {
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
  const since = new Date(Date.now() - LOGIN_LOCK_DURATION_MS);
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
  });
}

export async function login(db: Database, input: LoginInput): Promise<LoginResult> {
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

  if (user.role === "student" && (await isStudentAccountFrozen(db, user.id))) {
    throw new IdentityError("FORBIDDEN", "Account is not available");
  }

  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    throw new IdentityError("ACCOUNT_LOCKED", "Account is temporarily locked");
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
    if (failures >= MAX_LOGIN_FAILURES) {
      const lockedUntil = new Date(Date.now() + LOGIN_LOCK_DURATION_MS);
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

    throw new IdentityError("INVALID_CREDENTIALS", "Invalid credentials");
  }

  if (user.status === "locked") {
    await db
      .update(users)
      .set({
        status: user.contactVerifiedAt ? "active" : "pending_verification",
        lockedUntil: null,
      })
      .where(eq(users.id, user.id));
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
    contactVerified: user.role === "admin" || user.contactVerifiedAt !== null,
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

  if (result.user.role === "student" && (await isStudentAccountFrozen(db, result.user.id))) {
    await lucia.invalidateSession(sessionId);
    return null;
  }

  return result;
}
