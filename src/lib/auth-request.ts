import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getDb, type Database } from "@/db";
import { users } from "@/db/schema";
import { createLucia } from "@/lib/lucia";
import { IdentityError } from "@/modules/identity/errors";
import { validateSession } from "@/modules/identity/login.service";
import { assertStudentMayPerformWrites } from "@/modules/identity/password-change-guard";
import { FamilyAccessError } from "@/modules/family-access/errors";

async function requireSession() {
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

  return { db, session: result.session, user: result.user, dbUser };
}

export async function requireAdminSession() {
  const ctx = await requireSession();
  if (ctx.dbUser.role !== "admin") {
    throw new IdentityError("FORBIDDEN", "Admin access required");
  }
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
  return ctx;
}

export async function requireVerifiedParentSession() {
  const ctx = await requireParentSession();
  if (!ctx.dbUser.contactVerifiedAt) {
    throw new FamilyAccessError("CONTACT_NOT_VERIFIED", "Parent contact must be verified");
  }
  return ctx;
}

export async function requireAuthenticatedSession() {
  return requireSession();
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

  await lucia.invalidateSession(currentSessionId);
  const newSession = await lucia.createSession(userId, {
    authorizationEpoch: user.authorizationEpoch,
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
