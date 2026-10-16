import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getDb, type Database } from "@/db";
import { sessions, users } from "@/db/schema";
import { createLucia } from "@/lib/lucia";
import { IdentityError } from "@/modules/identity/errors";
import { validateSession } from "@/modules/identity/login.service";
import { assertStudentMayPerformWrites } from "@/modules/identity/password-change-guard";
import { FamilyAccessError } from "@/modules/family-access/errors";
import { assertSubjectAccess } from "@/modules/data-lifecycle/subject-access.service";

async function requireSession(allowPasswordChangeRequired = false) {
  const db = getDb();
  const cookieStore = await cookies();
  const lucia = createLucia(db);
  const sessionId = cookieStore.get(lucia.sessionCookieName)?.value ?? null;

  if (!sessionId) {
    throw new IdentityError("UNAUTHORIZED", "Authentication required");
  }

  const result = await validateSession(db, sessionId);
  if (!result) {
    throw new IdentityError("UNAUTHORIZED", "Session is invalid");
  }

  const [dbUser] = await db.select().from(users).where(eq(users.id, result.user.id)).limit(1);
  if (!dbUser) {
    throw new IdentityError("USER_NOT_FOUND", "User not found");
  }
  if (dbUser.authorizationEpoch !== result.session.authorizationEpoch) {
    throw new IdentityError("UNAUTHORIZED", "Session is invalid");
  }
  if (dbUser.status === "disabled" || dbUser.status === "locked") {
    throw new IdentityError("FORBIDDEN", "账号当前不可用");
  }
  if (dbUser.mustChangePassword && !allowPasswordChangeRequired) {
    throw new IdentityError("PASSWORD_CHANGE_REQUIRED", "请先设置自己的新密码");
  }

  return { db, session: result.session, user: result.user, dbUser };
}

export async function requireAdminSession() {
  const ctx = await requireSession();
  if (ctx.dbUser.role !== "admin") {
    throw new IdentityError("FORBIDDEN", "Admin access required");
  }
  if (!ctx.session.mfaVerifiedAt) throw new IdentityError("MFA_REQUIRED", "管理员第二因素验证必需");
  return ctx;
}

export async function requireParentSession() {
  const ctx = await requireSession();
  if (ctx.dbUser.role !== "parent") {
    throw new FamilyAccessError("FORBIDDEN", "Parent access required");
  }
  return ctx;
}

export async function requireStudentSession() {
  const ctx = await requireSession();
  if (ctx.dbUser.role !== "student") {
    throw new FamilyAccessError("FORBIDDEN", "Student access required");
  }
  return ctx;
}

export async function requireStudentSessionForWrites() {
  const ctx = await requireStudentSession();
  assertStudentMayPerformWrites(ctx.dbUser);
  await assertSubjectAccess(ctx.db, ctx.dbUser.id, "write");
  return ctx;
}

export async function requireVerifiedParentSession() {
  const ctx = await requireParentSession();
  if (!ctx.dbUser.contactVerifiedAt) {
    throw new FamilyAccessError("CONTACT_NOT_VERIFIED", "Parent contact must be verified");
  }
  return ctx;
}

export async function requireAuthenticatedSession(options?: {
  allowPasswordChangeRequired?: boolean;
}) {
  return requireSession(options?.allowPasswordChangeRequired);
}

export async function requireTraineeSession() {
  const ctx = await requireAuthenticatedSession();
  if (ctx.dbUser.role !== "student" && ctx.dbUser.role !== "parent") {
    throw new IdentityError("FORBIDDEN", "Training access requires student or parent");
  }
  if (ctx.dbUser.role === "parent" && !ctx.dbUser.contactVerifiedAt) {
    throw new FamilyAccessError("CONTACT_NOT_VERIFIED", "Parent contact must be verified");
  }
  return ctx;
}

export async function requireTraineeSessionForWrites() {
  const ctx = await requireTraineeSession();
  if (ctx.dbUser.role === "student") {
    assertStudentMayPerformWrites(ctx.dbUser);
    await assertSubjectAccess(ctx.db, ctx.dbUser.id, "write");
  }
  return ctx;
}

export async function refreshSessionCookieAfterEpochChange(
  db: Database,
  userId: string,
  currentSessionId: string,
) {
  const lucia = createLucia(db);
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) {
    throw new IdentityError("USER_NOT_FOUND", "User not found");
  }

  const [previous] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, currentSessionId))
    .limit(1);
  if (!previous || previous.userId !== userId || previous.expiresAt.getTime() <= Date.now()) {
    throw new IdentityError("UNAUTHORIZED", "Session is invalid");
  }
  if (user.role === "admin" && !previous.mfaVerifiedAt)
    throw new IdentityError("MFA_REQUIRED", "管理员第二因素验证必需");

  await lucia.invalidateSession(currentSessionId);
  const newSession = await lucia.createSession(userId, {
    authorizationEpoch: user.authorizationEpoch,
    mfaVerifiedAt: previous.mfaVerifiedAt,
  });
  const sessionCookie = lucia.createSessionCookie(newSession.id);

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

export function jsonWithSessionCookie<T>(
  payload: T,
  sessionCookie?: {
    name: string;
    value: string;
    attributes: {
      secure: boolean;
      path: string;
      httpOnly: boolean;
      sameSite: "lax" | "strict" | "none";
    };
  },
  init?: ResponseInit,
) {
  const response = NextResponse.json(payload, init);
  if (sessionCookie) {
    response.cookies.set(sessionCookie.name, sessionCookie.value, sessionCookie.attributes);
  }
  return response;
}

export function clearSessionCookie(sessionCookieName: string) {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(sessionCookieName, "", {
    path: "/",
    maxAge: 0,
  });
  return response;
}
