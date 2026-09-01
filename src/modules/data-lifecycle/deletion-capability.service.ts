import { and, eq, gt } from "drizzle-orm";

import type { Database } from "@/db";
import { deletionCapabilities, deletionRequests } from "@/db/schema";
import { DELETION_STATUS } from "@/modules/data-lifecycle/constants";
import { DataLifecycleError } from "@/modules/data-lifecycle/errors";
import { appendAuditEvent } from "@/modules/audit/append-audit-event";
import {
  generateDeletionCapabilityToken,
  hashDeletionCapabilityToken,
  verifyPassword,
} from "@/lib/crypto";
import { findUserByIdentifier } from "@/modules/identity/login.service";
import { IdentityError } from "@/modules/identity/errors";

/** Short-lived narrow capability for frozen-student deletion management only. */
export const DELETION_CAPABILITY_TTL_MS = 20 * 60 * 1000;
export const DELETION_CAPABILITY_SCOPE = "deletion.manage";
export const DELETION_CAPABILITY_COOKIE = "deletion_capability";

export type IssueDeletionCapabilityInput = {
  identifier: string;
  password: string;
  requestId: string;
  requestIdHeader?: string;
};

export type IssueDeletionCapabilityResult = {
  capabilityToken: string;
  expiresAt: Date;
};

/**
 * Re-authenticates a frozen student with username/password WITHOUT creating a
 * generic session, and issues a narrow capability bound to one deletion request.
 * The capability only authorizes deletion status/cancel/confirm for that request,
 * is short-lived, and is stored as a hash only.
 */
export async function issueDeletionCapability(
  db: Database,
  input: IssueDeletionCapabilityInput,
): Promise<IssueDeletionCapabilityResult> {
  const user = await findUserByIdentifier(db, input.identifier);
  if (!user) {
    throw new IdentityError("INVALID_CREDENTIALS", "Invalid credentials");
  }

  if (user.role !== "student") {
    throw new IdentityError("FORBIDDEN", "Deletion management requires a student account");
  }

  if (user.status === "disabled") {
    throw new IdentityError("FORBIDDEN", "Account is disabled");
  }

  const passwordValid = await verifyPassword(input.password, user.passwordHash);
  if (!passwordValid) {
    throw new IdentityError("INVALID_CREDENTIALS", "Invalid credentials");
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + DELETION_CAPABILITY_TTL_MS);

  return db.transaction(async (tx) => {
    const [request] = await tx
      .select()
      .from(deletionRequests)
      .where(and(eq(deletionRequests.id, input.requestId), eq(deletionRequests.studentId, user.id)))
      .limit(1);

    if (!request) {
      throw new DataLifecycleError("NOT_FOUND", "Deletion request not found");
    }

    if (request.status !== DELETION_STATUS.FROZEN) {
      throw new DataLifecycleError(
        "STATE_CONFLICT",
        "Deletion request is not in a manageable state",
      );
    }

    const capabilityToken = generateDeletionCapabilityToken();
    await tx.insert(deletionCapabilities).values({
      deletionRequestId: request.id,
      studentId: user.id,
      tokenHash: hashDeletionCapabilityToken(capabilityToken),
      scope: DELETION_CAPABILITY_SCOPE,
      expiresAt,
      createdAt: now,
    });

    await appendAuditEvent(tx, {
      actorId: user.id,
      action: "deletion.capability_issued",
      resourceType: "deletion_request",
      resourceId: request.id,
      idempotencyKey: `audit:deletion.capability:${request.id}:${crypto.randomUUID()}`,
      requestId: input.requestIdHeader,
      metadata: { studentId: user.id },
    });

    return { capabilityToken, expiresAt };
  });
}

/**
 * Validates a capability token for a deletion request. Used by the status,
 * cancel and confirm routes to authorize frozen-student deletion management
 * without granting a generic session.
 */
export async function findValidDeletionCapability(
  db: Database,
  requestId: string,
  token: string,
): Promise<typeof deletionCapabilities.$inferSelect | null> {
  const tokenHash = hashDeletionCapabilityToken(token);
  const [row] = await db
    .select()
    .from(deletionCapabilities)
    .where(
      and(
        eq(deletionCapabilities.tokenHash, tokenHash),
        eq(deletionCapabilities.deletionRequestId, requestId),
        eq(deletionCapabilities.scope, DELETION_CAPABILITY_SCOPE),
        gt(deletionCapabilities.expiresAt, new Date()),
      ),
    )
    .limit(1);

  return row ?? null;
}
