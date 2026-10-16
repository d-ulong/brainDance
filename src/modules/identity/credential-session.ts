import { and, eq } from "drizzle-orm";
import type { Database } from "@/db";
import { sessions, users } from "@/db/schema";
import { IdentityError } from "@/modules/identity/errors";
import { findActiveStudentAccountFreeze } from "@/modules/data-lifecycle/freeze-guard.service";

/** Caller locks the user first; every credential writer follows that order. */
export async function requireCredentialSession(db: Database, userId: string, sessionId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const [session] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
    .limit(1);
  if (
    !user ||
    !session ||
    session.expiresAt.getTime() <= Date.now() ||
    session.authorizationEpoch !== user.authorizationEpoch
  ) {
    throw new IdentityError("UNAUTHORIZED", "登录已失效，请重新登录");
  }
  if (
    user.status === "disabled" ||
    user.status === "locked" ||
    (user.role === "admin" && user.status !== "active")
  ) {
    throw new IdentityError("FORBIDDEN", "账号当前不可用");
  }
  if (user.role === "admin" && !session.mfaVerifiedAt) {
    throw new IdentityError("MFA_REQUIRED", "管理员第二因素验证必需");
  }
  if (user.role === "student" && (await findActiveStudentAccountFreeze(db, user.id))) {
    throw new IdentityError("FORBIDDEN", "账号已冻结");
  }
  return { user, session };
}

export async function requireAccountAdministrator(db: Database, userId: string, sessionId: string) {
  const ctx = await requireCredentialSession(db, userId, sessionId);
  if (ctx.user.role !== "admin") throw new IdentityError("FORBIDDEN", "需要管理员权限");
  if (ctx.user.mustChangePassword) {
    throw new IdentityError("PASSWORD_CHANGE_REQUIRED", "请先设置自己的新密码");
  }
  return ctx;
}
