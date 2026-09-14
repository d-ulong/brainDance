import { eq, sql } from "drizzle-orm";
import type { Database } from "@/db";
import { invitationRedemptions, invitations, users } from "@/db/schema";
import { appendAuditEvent } from "@/modules/audit/append-audit-event";
import { appendOutboxEvent } from "@/modules/outbox/append-outbox-event";
import { hashPassword, hashInviteCode, normalizeAccountKey } from "@/lib/crypto";
import { isPostgresUniqueViolation } from "@/lib/postgres-errors";
import { IdentityError } from "./errors";
import { resolveInvitationByCode } from "./invitation.service";
import { assertProductPassword } from "./password-policy";
import { assertStudentBirthDate } from "./student-birth-date";

export type RegisterParentInput = {
  invitationCode: string;
  displayName: string;
  email?: string;
  phone?: string;
  password: string;
  idempotencyKey: string;
  requestId?: string;
};
export type RegisterStudentInput = Omit<RegisterParentInput, "email" | "phone"> & {
  username: string;
  birthDate: string;
};
type RegisterInput =
  (RegisterParentInput & { role: "parent" }) | (RegisterStudentInput & { role: "student" });
export type RegisterParentResult = {
  userId: string;
  status: "pending_verification" | "active";
  contactType: "email" | "phone" | "username";
  contactValue: string;
  idempotentReplay: boolean;
};

export function registerParent(db: Database, input: RegisterParentInput) {
  return registerAccount(db, { ...input, role: "parent" });
}
export function registerStudent(db: Database, input: RegisterStudentInput) {
  return registerAccount(db, { ...input, role: "student" });
}

async function registerAccount(db: Database, input: RegisterInput): Promise<RegisterParentResult> {
  const displayName = input.displayName.trim();
  if (!displayName || displayName.length > 64)
    throw new IdentityError("VALIDATION_ERROR", "请填写 1–64 字的姓名或昵称");
  let contactType: "email" | "phone" | "username";
  let contactValue: string;
  if (input.role === "student") {
    assertStudentBirthDate(input.birthDate, 13, 18);
    contactType = "username";
    contactValue = input.username.trim();
    if (!/^[a-zA-Z0-9_-]{3,64}$/.test(contactValue))
      throw new IdentityError("VALIDATION_ERROR", "用户名须为 3–64 位字母、数字、下划线或短横线");
  } else {
    if (Boolean(input.email?.trim()) === Boolean(input.phone?.trim()))
      throw new IdentityError("VALIDATION_ERROR", "Provide exactly one of email or phone");
    contactType = input.email?.trim() ? "email" : "phone";
    contactValue =
      contactType === "email" ? normalizeAccountKey(input.email!) : input.phone!.trim();
  }
  assertProductPassword(input.password);
  const passwordHash = await hashPassword(input.password);
  try {
    return await db.transaction(async (tx) => {
      // Serialize the command before looking for a replay, including different invitations.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${"registration:" + input.idempotencyKey}, 0))`,
      );
      const [replay] = await tx
        .select({ user: users, invitation: invitations })
        .from(invitationRedemptions)
        .innerJoin(users, eq(invitationRedemptions.userId, users.id))
        .innerJoin(invitations, eq(invitationRedemptions.invitationId, invitations.id))
        .where(eq(invitationRedemptions.idempotencyKey, input.idempotencyKey))
        .limit(1);
      if (replay) {
        if (
          replay.user.role !== input.role ||
          replay.user[contactType] !== contactValue ||
          replay.user.displayName !== displayName ||
          replay.invitation.codeHash !== hashInviteCode(input.invitationCode) ||
          (input.role === "student" && replay.user.birthDate !== input.birthDate)
        ) {
          throw new IdentityError("VALIDATION_ERROR", "同一注册请求不能更换资料，请重新提交");
        }
        return {
          userId: replay.user.id,
          status: replay.user.status === "pending_verification" ? "pending_verification" : "active",
          contactType,
          contactValue,
          idempotentReplay: true,
        };
      }
      const invitation = await resolveInvitationByCode(tx, input.invitationCode, input.role);
      const [locked] = await tx
        .select()
        .from(invitations)
        .where(eq(invitations.id, invitation.invitationId))
        .for("update");
      if (
        !locked ||
        locked.revokedAt ||
        locked.expiresAt.getTime() <= Date.now() ||
        locked.usedCount >= locked.maxUses
      ) {
        throw new IdentityError("INVITATION_INVALID", "邀请码已失效或使用完毕");
      }
      const [existing] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users[contactType], contactValue))
        .limit(1);
      if (existing) throw new IdentityError("CONTACT_ALREADY_USED", "该登录账号已被注册");
      const status = input.role === "student" ? "active" : "pending_verification";
      const [created] = await tx
        .insert(users)
        .values({
          role: input.role,
          displayName,
          passwordHash,
          status,
          email: contactType === "email" ? contactValue : null,
          phone: contactType === "phone" ? contactValue : null,
          username: contactType === "username" ? contactValue : null,
          birthDate: input.role === "student" ? input.birthDate : null,
        })
        .returning({ id: users.id });
      if (!created) throw new Error("Failed to create account");
      await tx.insert(invitationRedemptions).values({
        invitationId: locked.id,
        userId: created.id,
        idempotencyKey: input.idempotencyKey,
      });
      await tx
        .update(invitations)
        .set({ usedCount: locked.usedCount + 1 })
        .where(eq(invitations.id, locked.id));
      await appendAuditEvent(tx, {
        actorId: created.id,
        action: "invitation.redeemed",
        resourceType: "invitation",
        resourceId: locked.id,
        requestId: input.requestId,
        idempotencyKey: "audit:invite-redeem:" + input.idempotencyKey,
        metadata: { targetRole: input.role },
      });
      await appendAuditEvent(tx, {
        actorId: created.id,
        action: "user.registered",
        resourceType: "user",
        resourceId: created.id,
        requestId: input.requestId,
        idempotencyKey: "audit:register:" + input.idempotencyKey,
        metadata: { role: input.role, contactType },
      });
      await appendOutboxEvent(tx, {
        aggregateType: "invitation",
        aggregateId: locked.id,
        eventType: "invitation.redeemed",
        dedupeKey: "outbox:invite-redeem:" + input.idempotencyKey,
        payload: { invitationId: locked.id, userId: created.id, targetRole: input.role },
      });
      return { userId: created.id, status, contactType, contactValue, idempotentReplay: false };
    });
  } catch (error) {
    if (isPostgresUniqueViolation(error))
      throw new IdentityError("CONTACT_ALREADY_USED", "该登录账号已被注册");
    throw error;
  }
}
