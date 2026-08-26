import { and, eq, isNull } from "drizzle-orm";

import type { Database } from "@/db";
import { invitations } from "@/db/schema";
import { appendAuditEvent } from "@/modules/audit/append-audit-event";
import {
  ADMIN_INVITE_TTL_MS,
  PARENT_INVITE_TTL_MS,
  STUDENT_INVITE_TTL_MS,
  type UserRole,
} from "@/modules/identity/constants";
import { IdentityError } from "@/modules/identity/errors";
import { generateInviteCodePlaintext, hashInviteCode } from "@/lib/crypto";

export type CreateInvitationInput = {
  adminId: string;
  targetRole: UserRole;
  maxUses?: number;
  expiresAt?: Date;
  idempotencyKey: string;
  requestId?: string;
};

export type CreateInvitationResult = {
  invitationId: string;
  /** Plaintext is returned once and must not be persisted or logged. */
  codePlaintext: string;
  expiresAt: Date;
  targetRole: UserRole;
  maxUses: number;
  idempotentReplay: boolean;
};

export type RevokeInvitationInput = {
  adminId: string;
  invitationId: string;
  idempotencyKey: string;
  requestId?: string;
};

export type RevokeInvitationResult = {
  invitationId: string;
  revokedAt: Date;
  idempotentReplay: boolean;
};

function defaultExpiryForRole(role: UserRole): Date {
  const now = Date.now();
  const ttl =
    role === "admin"
      ? ADMIN_INVITE_TTL_MS
      : role === "student"
        ? STUDENT_INVITE_TTL_MS
        : PARENT_INVITE_TTL_MS;
  return new Date(now + ttl);
}

export async function createInvitation(
  db: Database,
  input: CreateInvitationInput,
): Promise<CreateInvitationResult> {
  if (input.idempotencyKey) {
    const [existing] = await db
      .select()
      .from(invitations)
      .where(eq(invitations.creationIdempotencyKey, input.idempotencyKey))
      .limit(1);

    if (existing) {
      return {
        invitationId: existing.id,
        codePlaintext: "",
        expiresAt: existing.expiresAt,
        targetRole: existing.targetRole,
        maxUses: existing.maxUses,
        idempotentReplay: true,
      };
    }
  }

  const codePlaintext = generateInviteCodePlaintext();
  const codeHash = hashInviteCode(codePlaintext);
  const expiresAt = input.expiresAt ?? defaultExpiryForRole(input.targetRole);
  const maxUses = input.maxUses ?? 1;

  const [created] = await db
    .insert(invitations)
    .values({
      codeHash,
      targetRole: input.targetRole,
      expiresAt,
      maxUses,
      createdById: input.adminId,
      creationIdempotencyKey: input.idempotencyKey,
    })
    .returning();

  if (!created) {
    throw new Error("Failed to create invitation");
  }

  await appendAuditEvent(db, {
    actorId: input.adminId,
    action: "invitation.created",
    resourceType: "invitation",
    resourceId: created.id,
    requestId: input.requestId,
    idempotencyKey: `audit:${input.idempotencyKey}`,
    metadata: {
      targetRole: input.targetRole,
      maxUses,
      expiresAt: expiresAt.toISOString(),
    },
  });

  return {
    invitationId: created.id,
    codePlaintext,
    expiresAt: created.expiresAt,
    targetRole: created.targetRole,
    maxUses: created.maxUses,
    idempotentReplay: false,
  };
}

export async function revokeInvitation(
  db: Database,
  input: RevokeInvitationInput,
): Promise<RevokeInvitationResult> {
  const auditKey = `audit:revoke:${input.idempotencyKey}`;
  const [existingAudit] = await db
    .select({ id: invitations.id, revokedAt: invitations.revokedAt })
    .from(invitations)
    .where(eq(invitations.id, input.invitationId))
    .limit(1);

  if (!existingAudit) {
    throw new IdentityError("INVITATION_INVALID", "Invitation not found");
  }

  if (existingAudit.revokedAt) {
    return {
      invitationId: input.invitationId,
      revokedAt: existingAudit.revokedAt,
      idempotentReplay: true,
    };
  }

  const revokedAt = new Date();
  await db
    .update(invitations)
    .set({ revokedAt })
    .where(and(eq(invitations.id, input.invitationId), isNull(invitations.revokedAt)));

  await appendAuditEvent(db, {
    actorId: input.adminId,
    action: "invitation.revoked",
    resourceType: "invitation",
    resourceId: input.invitationId,
    requestId: input.requestId,
    idempotencyKey: auditKey,
  });

  return {
    invitationId: input.invitationId,
    revokedAt,
    idempotentReplay: false,
  };
}

export type ResolvedInvitation = {
  invitationId: string;
  targetRole: UserRole;
  expiresAt: Date;
  maxUses: number;
  usedCount: number;
};

export async function resolveInvitationByCode(
  db: Database,
  codePlaintext: string,
  expectedRole: UserRole,
): Promise<ResolvedInvitation> {
  const codeHash = hashInviteCode(codePlaintext);
  const [invitation] = await db
    .select()
    .from(invitations)
    .where(eq(invitations.codeHash, codeHash))
    .limit(1);

  if (!invitation) {
    throw new IdentityError("INVITATION_INVALID", "Invitation code is invalid");
  }

  if (invitation.revokedAt) {
    throw new IdentityError("INVITATION_REVOKED", "Invitation code has been revoked");
  }

  if (invitation.expiresAt.getTime() <= Date.now()) {
    throw new IdentityError("INVITATION_EXPIRED", "Invitation code has expired");
  }

  if (invitation.usedCount >= invitation.maxUses) {
    throw new IdentityError("INVITATION_EXHAUSTED", "Invitation code has no remaining uses");
  }

  if (invitation.targetRole !== expectedRole) {
    throw new IdentityError("INVITATION_ROLE_MISMATCH", "Invitation code role mismatch");
  }

  return {
    invitationId: invitation.id,
    targetRole: invitation.targetRole,
    expiresAt: invitation.expiresAt,
    maxUses: invitation.maxUses,
    usedCount: invitation.usedCount,
  };
}
