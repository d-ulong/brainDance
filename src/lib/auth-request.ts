import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getDb } from "@/db";
import { users } from "@/db/schema";
import { createLucia } from "@/lib/lucia";
import { IdentityError } from "@/modules/identity/errors";
import { validateSession } from "@/modules/identity/login.service";
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

export async function requireAuthenticatedSession() {
  return requireSession();
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
