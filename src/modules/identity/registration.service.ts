import { eq } from "drizzle-orm";

import type { Database } from "@/db";
import { invitationRedemptions, invitations, users } from "@/db/schema";
import { appendAuditEvent } from "@/modules/audit/append-audit-event";
import { appendOutboxEvent } from "@/modules/outbox/append-outbox-event";
import { hashPassword, normalizeAccountKey } from "@/lib/crypto";
import { IdentityError } from "@/modules/identity/errors";
import { resolveInvitationByCode } from "@/modules/identity/invitation.service";
import { assertProductPassword } from "@/modules/identity/password-policy";

export type RegisterParentInput = {
  invitationCode: string;
  displayName: string;
  email?: string;
  phone?: string;
  password: string;
  idempotencyKey: string;
  requestId?: string;
};

export type RegisterParentResult = {
  userId: string;
  status: "pending_verification";
  contactType: "email" | "phone";
  contactValue: string;
  idempotentReplay: boolean;
};

function resolveContact(input: RegisterParentInput): {
  contactType: "email" | "phone";
  contactValue: string;
} {
  const email = input.email?.trim();
  const phone = input.phone?.trim();

  if (Boolean(email) === Boolean(phone)) {
    throw new IdentityError("VALIDATION_ERROR", "Provide exactly one of email or phone");
  }

  if (email) {
    return { contactType: "email", contactValue: normalizeAccountKey(email) };
  }

  return { contactType: "phone", contactValue: phone!.trim() };
}

export async function registerParent(
  db: Database,
  input: RegisterParentInput,
): Promise<RegisterParentResult> {
  const contact = resolveContact(input);

  const [existingRedemption] = await db
    .select({
      userId: invitationRedemptions.userId,
      invitationId: invitationRedemptions.invitationId,
    })
    .from(invitationRedemptions)
    .innerJoin(invitations, eq(invitationRedemptions.invitationId, invitations.id))
    .where(eq(invitationRedemptions.idempotencyKey, input.idempotencyKey))
    .limit(1);

  if (existingRedemption?.userId) {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, existingRedemption.userId))
      .limit(1);
    if (!user) {
      throw new IdentityError("USER_NOT_FOUND", "Registered user not found for idempotent replay");
    }
    const contactValue = user.email ?? user.phone;
    if (!contactValue) {
      throw new IdentityError("USER_NOT_FOUND", "Registered user contact missing");
    }
    return {
      userId: user.id,
      status: "pending_verification",
      contactType: user.email ? "email" : "phone",
      contactValue,
      idempotentReplay: true,
    };
  }

  const invitation = await resolveInvitationByCode(db, input.invitationCode, "parent");

  if (contact.contactType === "email") {
    const [existingEmail] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, contact.contactValue))
      .limit(1);
    if (existingEmail) {
      throw new IdentityError("CONTACT_ALREADY_USED", "Email is already registered");
    }
  } else {
    const [existingPhone] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.phone, contact.contactValue))
      .limit(1);
    if (existingPhone) {
      throw new IdentityError("CONTACT_ALREADY_USED", "Phone is already registered");
    }
  }

  assertProductPassword(input.password);
  const passwordHash = await hashPassword(input.password);

  return db.transaction(async (tx) => {
    const [lockedInvitation] = await tx
      .select()
      .from(invitations)
      .where(eq(invitations.id, invitation.invitationId))
      .limit(1);

    if (!lockedInvitation) {
      throw new IdentityError("INVITATION_INVALID", "Invitation not found");
    }

    if (
      lockedInvitation.revokedAt ||
      lockedInvitation.expiresAt.getTime() <= Date.now() ||
      lockedInvitation.usedCount >= lockedInvitation.maxUses
    ) {
      throw new IdentityError("INVITATION_INVALID", "Invitation is no longer valid");
    }

    const [createdUser] = await tx
      .insert(users)
      .values({
        role: "parent",
        displayName: input.displayName.trim(),
        email: contact.contactType === "email" ? contact.contactValue : null,
        phone: contact.contactType === "phone" ? contact.contactValue : null,
        passwordHash,
        status: "pending_verification",
      })
      .returning();

    if (!createdUser) {
      throw new Error("Failed to create parent user");
    }

    await tx.insert(invitationRedemptions).values({
      invitationId: invitation.invitationId,
      userId: createdUser.id,
      idempotencyKey: input.idempotencyKey,
    });

    await tx
      .update(invitations)
      .set({ usedCount: lockedInvitation.usedCount + 1 })
      .where(eq(invitations.id, invitation.invitationId));

    await appendAuditEvent(tx, {
      actorId: createdUser.id,
      action: "invitation.redeemed",
      resourceType: "invitation",
      resourceId: invitation.invitationId,
      requestId: input.requestId,
      idempotencyKey: `audit:invite-redeem:${input.idempotencyKey}`,
      metadata: { targetRole: invitation.targetRole },
    });

    await appendAuditEvent(tx, {
      actorId: createdUser.id,
      action: "user.registered",
      resourceType: "user",
      resourceId: createdUser.id,
      requestId: input.requestId,
      idempotencyKey: `audit:register:${input.idempotencyKey}`,
      metadata: {
        role: "parent",
        contactType: contact.contactType,
      },
    });

    await appendOutboxEvent(tx, {
      aggregateType: "invitation",
      aggregateId: invitation.invitationId,
      eventType: "invitation.redeemed",
      dedupeKey: `outbox:invite-redeem:${input.idempotencyKey}`,
      payload: {
        invitationId: invitation.invitationId,
        userId: createdUser.id,
        targetRole: invitation.targetRole,
      },
    });

    return {
      userId: createdUser.id,
      status: "pending_verification" as const,
      contactType: contact.contactType,
      contactValue: contact.contactValue,
      idempotentReplay: false,
    };
  });
}
