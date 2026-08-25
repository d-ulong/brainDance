import { and, eq, sql } from "drizzle-orm";

import type { Database } from "@/db";
import {
  families,
  familyMemberships,
  guardianConsents,
  relationshipRequests,
  relationships,
  studentAssociationCodes,
  users,
} from "@/db/schema";
import { appendAuditEvent } from "@/modules/audit/append-audit-event";
import { appendOutboxEvent } from "@/modules/outbox/append-outbox-event";
import {
  assertNoActiveRelationshipPair,
  countActiveRelationshipsForStudent,
  requireActiveRelationship,
} from "@/modules/family-access/authorization.service";
import { resolveAssociationCodeByPlaintext } from "@/modules/family-access/association-code.service";
import {
  FAMILY_TIMEZONE,
  M1_GUARDIAN_CONSENT_TYPE,
  M1_GUARDIAN_POLICY_VERSION,
  RELATIONSHIP_REQUEST_TTL_MS,
} from "@/modules/family-access/constants";
import { FamilyAccessError } from "@/modules/family-access/errors";
import { IdentityError } from "@/modules/identity/errors";

export type CreateRelationshipRequestInput = {
  parentId: string;
  associationCodePlaintext: string;
  idempotencyKey: string;
  requestId?: string;
};

export type CreateRelationshipRequestResult = {
  requestId: string;
  studentId: string;
  status: "pending";
  expiresAt: Date;
  idempotentReplay: boolean;
};

export type RespondRelationshipRequestInput = {
  studentId: string;
  requestId: string;
  idempotencyKey: string;
  requestIdHeader?: string;
};

export type AcceptRelationshipRequestResult = {
  relationshipId: string;
  familyId: string;
  idempotentReplay: boolean;
};

export type RejectRelationshipRequestResult = {
  requestId: string;
  status: "rejected";
  idempotentReplay: boolean;
};

async function requireVerifiedParent(db: Database, parentId: string) {
  const [parent] = await db.select().from(users).where(eq(users.id, parentId)).limit(1);
  if (!parent) {
    throw new FamilyAccessError("USER_NOT_FOUND", "Parent not found");
  }
  if (parent.role !== "parent") {
    throw new FamilyAccessError("FORBIDDEN", "Only parents can initiate relationship requests");
  }
  if (!parent.contactVerifiedAt) {
    throw new FamilyAccessError("CONTACT_NOT_VERIFIED", "Parent contact must be verified");
  }
  return parent;
}

export async function createRelationshipRequest(
  db: Database,
  input: CreateRelationshipRequestInput,
): Promise<CreateRelationshipRequestResult> {
  await requireVerifiedParent(db, input.parentId);

  const [existing] = await db
    .select()
    .from(relationshipRequests)
    .where(eq(relationshipRequests.createIdempotencyKey, input.idempotencyKey))
    .limit(1);

  if (existing) {
    return {
      requestId: existing.id,
      studentId: existing.studentId,
      status: "pending",
      expiresAt: existing.expiresAt,
      idempotentReplay: true,
    };
  }

  const resolved = await resolveAssociationCodeByPlaintext(db, input.associationCodePlaintext);

  await assertNoActiveRelationshipPair(db, input.parentId, resolved.studentId);

  const expiresAt = new Date(Date.now() + RELATIONSHIP_REQUEST_TTL_MS);
  const consumedAt = new Date();

  return db.transaction(async (tx) => {
    const [existingInTx] = await tx
      .select()
      .from(relationshipRequests)
      .where(eq(relationshipRequests.createIdempotencyKey, input.idempotencyKey))
      .limit(1);

    if (existingInTx) {
      return {
        requestId: existingInTx.id,
        studentId: existingInTx.studentId,
        status: "pending" as const,
        expiresAt: existingInTx.expiresAt,
        idempotentReplay: true,
      };
    }

    const [codeRow] = await tx
      .select()
      .from(studentAssociationCodes)
      .where(eq(studentAssociationCodes.id, resolved.associationCodeId))
      .limit(1);

    if (
      !codeRow ||
      codeRow.consumedAt ||
      codeRow.revokedAt ||
      codeRow.expiresAt.getTime() <= Date.now()
    ) {
      if (codeRow?.consumedAt) {
        throw new FamilyAccessError("ASSOCIATION_CODE_CONSUMED", "Association code already used");
      }
      if (codeRow?.revokedAt) {
        throw new FamilyAccessError("ASSOCIATION_CODE_REVOKED", "Association code revoked");
      }
      if (codeRow && codeRow.expiresAt.getTime() <= Date.now()) {
        throw new FamilyAccessError("ASSOCIATION_CODE_EXPIRED", "Association code expired");
      }
      throw new FamilyAccessError("ASSOCIATION_CODE_INVALID", "Association code invalid");
    }

    await tx
      .update(studentAssociationCodes)
      .set({ consumedAt })
      .where(
        and(
          eq(studentAssociationCodes.id, codeRow.id),
          sql`${studentAssociationCodes.consumedAt} IS NULL`,
        ),
      );

    const [createdRequest] = await tx
      .insert(relationshipRequests)
      .values({
        initiatorId: input.parentId,
        parentId: input.parentId,
        studentId: resolved.studentId,
        associationCodeId: codeRow.id,
        status: "pending",
        expiresAt,
        createIdempotencyKey: input.idempotencyKey,
      })
      .returning();

    if (!createdRequest) {
      throw new Error("Failed to create relationship request");
    }

    await appendAuditEvent(tx, {
      actorId: input.parentId,
      action: "relationship_request.created",
      resourceType: "relationship_request",
      resourceId: createdRequest.id,
      requestId: input.requestId,
      idempotencyKey: `audit:rel-req-create:${input.idempotencyKey}`,
      metadata: { studentId: resolved.studentId },
    });

    return {
      requestId: createdRequest.id,
      studentId: resolved.studentId,
      status: "pending" as const,
      expiresAt: createdRequest.expiresAt,
      idempotentReplay: false,
    };
  });
}

async function loadPendingRequestForStudent(db: Database, studentId: string, requestId: string) {
  const [request] = await db
    .select()
    .from(relationshipRequests)
    .where(eq(relationshipRequests.id, requestId))
    .limit(1);

  if (!request) {
    throw new FamilyAccessError("RELATIONSHIP_REQUEST_INVALID", "Relationship request not found");
  }

  if (request.studentId !== studentId) {
    throw new FamilyAccessError(
      "FORBIDDEN",
      "Relationship request does not belong to this student",
    );
  }

  if (request.status !== "pending") {
    throw new FamilyAccessError(
      "RELATIONSHIP_REQUEST_NOT_PENDING",
      "Relationship request is not pending",
    );
  }

  if (request.expiresAt.getTime() <= Date.now()) {
    await db
      .update(relationshipRequests)
      .set({ status: "expired", respondedAt: new Date() })
      .where(eq(relationshipRequests.id, request.id));
    throw new FamilyAccessError("RELATIONSHIP_REQUEST_EXPIRED", "Relationship request has expired");
  }

  return request;
}

async function syncMembership(
  tx: Database,
  input: {
    familyId: string;
    userId: string;
    memberRole: "parent" | "student";
    relationshipId: string;
    joinedAt: Date;
  },
) {
  const [existing] = await tx
    .select()
    .from(familyMemberships)
    .where(
      and(
        eq(familyMemberships.familyId, input.familyId),
        eq(familyMemberships.userId, input.userId),
        sql`${familyMemberships.leftAt} IS NULL`,
      ),
    )
    .limit(1);

  if (existing) {
    return existing.id;
  }

  const [created] = await tx
    .insert(familyMemberships)
    .values({
      familyId: input.familyId,
      userId: input.userId,
      memberRole: input.memberRole,
      joinedAt: input.joinedAt,
      derivedFromRelationshipId: input.relationshipId,
    })
    .returning({ id: familyMemberships.id });

  return created?.id;
}

async function incrementAuthorizationEpoch(tx: Database, userId: string) {
  const [user] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) {
    throw new FamilyAccessError("USER_NOT_FOUND", "User not found");
  }

  await tx
    .update(users)
    .set({
      authorizationEpoch: user.authorizationEpoch + 1,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
}

export async function acceptRelationshipRequest(
  db: Database,
  input: RespondRelationshipRequestInput,
): Promise<AcceptRelationshipRequestResult> {
  const [existingResponse] = await db
    .select()
    .from(relationshipRequests)
    .where(eq(relationshipRequests.respondIdempotencyKey, input.idempotencyKey))
    .limit(1);

  if (existingResponse?.status === "accepted") {
    const [relationship] = await db
      .select()
      .from(relationships)
      .where(
        and(
          eq(relationships.parentId, existingResponse.parentId),
          eq(relationships.studentId, existingResponse.studentId),
          eq(relationships.status, "active"),
        ),
      )
      .limit(1);

    if (!relationship) {
      throw new FamilyAccessError(
        "RELATIONSHIP_REQUEST_INVALID",
        "Accepted request missing relationship",
      );
    }

    return {
      relationshipId: relationship.id,
      familyId: relationship.familyId,
      idempotentReplay: true,
    };
  }

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT id FROM relationship_requests WHERE id = ${input.requestId} FOR UPDATE`,
    );

    const [existingInTx] = await tx
      .select()
      .from(relationshipRequests)
      .where(eq(relationshipRequests.respondIdempotencyKey, input.idempotencyKey))
      .limit(1);

    if (existingInTx?.status === "accepted") {
      const [relationship] = await tx
        .select()
        .from(relationships)
        .where(
          and(
            eq(relationships.parentId, existingInTx.parentId),
            eq(relationships.studentId, existingInTx.studentId),
            eq(relationships.status, "active"),
          ),
        )
        .limit(1);

      if (!relationship) {
        throw new FamilyAccessError(
          "RELATIONSHIP_REQUEST_INVALID",
          "Accepted request missing relationship",
        );
      }

      return {
        relationshipId: relationship.id,
        familyId: relationship.familyId,
        idempotentReplay: true,
      };
    }

    const request = await loadPendingRequestForStudent(tx, input.studentId, input.requestId);

    await assertNoActiveRelationshipPair(tx, request.parentId, request.studentId);

    const activeCount = await countActiveRelationshipsForStudent(tx, request.studentId);
    if (activeCount > 0) {
      throw new FamilyAccessError(
        "STUDENT_ALREADY_HAS_FAMILY",
        "Student already has an active family relationship",
      );
    }

    const acceptedAt = new Date();

    const [family] = await tx
      .insert(families)
      .values({ timezone: FAMILY_TIMEZONE })
      .returning({ id: families.id });
    if (!family) {
      throw new Error("Failed to create family");
    }
    const familyId = family.id;

    const [relationship] = await tx
      .insert(relationships)
      .values({
        familyId,
        parentId: request.parentId,
        studentId: request.studentId,
        status: "active",
        acceptedAt,
      })
      .returning();

    if (!relationship) {
      throw new Error("Failed to create relationship");
    }

    await syncMembership(tx, {
      familyId,
      userId: request.parentId,
      memberRole: "parent",
      relationshipId: relationship.id,
      joinedAt: acceptedAt,
    });
    await syncMembership(tx, {
      familyId,
      userId: request.studentId,
      memberRole: "student",
      relationshipId: relationship.id,
      joinedAt: acceptedAt,
    });

    const consentIdempotencyKey = `guardian-consent:${relationship.id}`;
    await tx
      .insert(guardianConsents)
      .values({
        studentId: request.studentId,
        parentId: request.parentId,
        consentType: M1_GUARDIAN_CONSENT_TYPE,
        policyVersion: M1_GUARDIAN_POLICY_VERSION,
        acceptedAt,
        evidence: { relationshipRequestId: request.id },
        recordIdempotencyKey: consentIdempotencyKey,
      })
      .onConflictDoNothing({ target: guardianConsents.recordIdempotencyKey });

    await incrementAuthorizationEpoch(tx, request.parentId);
    await incrementAuthorizationEpoch(tx, request.studentId);

    await tx
      .update(relationshipRequests)
      .set({
        status: "accepted",
        respondedAt: acceptedAt,
        respondIdempotencyKey: input.idempotencyKey,
      })
      .where(eq(relationshipRequests.id, request.id));

    await appendAuditEvent(tx, {
      actorId: input.studentId,
      action: "guardian_consent.recorded",
      resourceType: "guardian_consent",
      resourceId: relationship.id,
      requestId: input.requestIdHeader,
      idempotencyKey: `audit:guardian-consent:${input.idempotencyKey}`,
      metadata: {
        policyVersion: M1_GUARDIAN_POLICY_VERSION,
        consentType: M1_GUARDIAN_CONSENT_TYPE,
        parentId: request.parentId,
      },
    });

    await appendAuditEvent(tx, {
      actorId: input.studentId,
      action: "relationship.accepted",
      resourceType: "relationship",
      resourceId: relationship.id,
      requestId: input.requestIdHeader,
      idempotencyKey: `audit:rel-accept:${input.idempotencyKey}`,
      metadata: { familyId, parentId: request.parentId },
    });

    await appendOutboxEvent(tx, {
      aggregateType: "relationship",
      aggregateId: relationship.id,
      eventType: "relationship.accepted",
      dedupeKey: `outbox:rel-accept:${input.idempotencyKey}`,
      payload: {
        relationshipId: relationship.id,
        familyId,
        parentId: request.parentId,
        studentId: request.studentId,
      },
    });

    return {
      relationshipId: relationship.id,
      familyId,
      idempotentReplay: false,
    };
  });
}

export async function rejectRelationshipRequest(
  db: Database,
  input: RespondRelationshipRequestInput,
): Promise<RejectRelationshipRequestResult> {
  const [existingResponse] = await db
    .select()
    .from(relationshipRequests)
    .where(eq(relationshipRequests.respondIdempotencyKey, input.idempotencyKey))
    .limit(1);

  if (existingResponse?.status === "rejected") {
    return {
      requestId: existingResponse.id,
      status: "rejected",
      idempotentReplay: true,
    };
  }

  const request = await loadPendingRequestForStudent(db, input.studentId, input.requestId);
  const respondedAt = new Date();

  await db
    .update(relationshipRequests)
    .set({
      status: "rejected",
      respondedAt,
      respondIdempotencyKey: input.idempotencyKey,
    })
    .where(eq(relationshipRequests.id, request.id));

  await appendAuditEvent(db, {
    actorId: input.studentId,
    action: "relationship.rejected",
    resourceType: "relationship_request",
    resourceId: request.id,
    requestId: input.requestIdHeader,
    idempotencyKey: `audit:rel-reject:${input.idempotencyKey}`,
    metadata: { parentId: request.parentId },
  });

  return {
    requestId: request.id,
    status: "rejected",
    idempotentReplay: false,
  };
}

export async function getStudentProfileForParent(
  db: Database,
  parentId: string,
  studentId: string,
): Promise<{ studentId: string; displayName: string; familyId: string }> {
  const access = await requireActiveRelationship(db, parentId, studentId);

  const [student] = await db.select().from(users).where(eq(users.id, studentId)).limit(1);
  if (!student) {
    throw new IdentityError("USER_NOT_FOUND", "Student not found");
  }

  return {
    studentId: student.id,
    displayName: student.displayName,
    familyId: access.familyId,
  };
}
