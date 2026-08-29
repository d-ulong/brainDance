import { eq, sql } from "drizzle-orm";

import type { Database } from "@/db";
import { auditEvents, relationships, users } from "@/db/schema";
import { appendAuditEvent } from "@/modules/audit/append-audit-event";
import { deactivateCreatorConfigsOnRelationshipEnd } from "@/modules/family-access/deactivate-creator-configs.service";
import { FamilyAccessError } from "@/modules/family-access/errors";
import { reconcileMembershipAfterRelationshipEnd } from "@/modules/family-access/membership-projection.service";
import { appendOutboxEvent } from "@/modules/outbox/append-outbox-event";

export type EndRelationshipInput = {
  actorId: string;
  relationshipId: string;
  idempotencyKey: string;
  requestId?: string;
};

export type EndRelationshipResult = {
  relationshipId: string;
  status: "ended";
  idempotentReplay: boolean;
};

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

async function findEndedReplay(
  db: Database,
  input: EndRelationshipInput,
): Promise<EndRelationshipResult | null> {
  const auditKey = `audit:rel-end:${input.idempotencyKey}`;
  const [existingAudit] = await db
    .select({ resourceId: auditEvents.resourceId })
    .from(auditEvents)
    .where(eq(auditEvents.idempotencyKey, auditKey))
    .limit(1);

  if (!existingAudit?.resourceId) {
    return null;
  }

  if (existingAudit.resourceId !== input.relationshipId) {
    throw new FamilyAccessError(
      "RELATIONSHIP_NOT_ACTIVE",
      "Idempotency key is bound to a different relationship end",
    );
  }

  return {
    relationshipId: existingAudit.resourceId,
    status: "ended",
    idempotentReplay: true,
  };
}

export async function endRelationship(
  db: Database,
  input: EndRelationshipInput,
): Promise<EndRelationshipResult> {
  const replay = await findEndedReplay(db, input);
  if (replay) {
    return replay;
  }

  return db.transaction(async (tx) => {
    const replayInTx = await findEndedReplay(tx, input);
    if (replayInTx) {
      return replayInTx;
    }

    await tx.execute(
      sql`SELECT id FROM relationships WHERE id = ${input.relationshipId} FOR UPDATE`,
    );

    const [relationship] = await tx
      .select()
      .from(relationships)
      .where(eq(relationships.id, input.relationshipId))
      .limit(1);

    if (!relationship) {
      throw new FamilyAccessError("RELATIONSHIP_NOT_FOUND", "Relationship not found");
    }

    if (relationship.status === "ended") {
      throw new FamilyAccessError("RELATIONSHIP_NOT_ACTIVE", "Relationship is already ended");
    }

    if (input.actorId !== relationship.parentId && input.actorId !== relationship.studentId) {
      throw new FamilyAccessError(
        "FORBIDDEN",
        "Only linked parent or student can end the relationship",
      );
    }

    const endedAt = new Date();

    await tx
      .update(relationships)
      .set({
        status: "ended",
        endedAt,
        endedBy: input.actorId,
      })
      .where(eq(relationships.id, input.relationshipId));

    await reconcileMembershipAfterRelationshipEnd(tx, {
      familyId: relationship.familyId,
      userId: relationship.parentId,
      endedAt,
    });
    await reconcileMembershipAfterRelationshipEnd(tx, {
      familyId: relationship.familyId,
      userId: relationship.studentId,
      endedAt,
    });

    await deactivateCreatorConfigsOnRelationshipEnd(tx, {
      parentId: relationship.parentId,
      studentId: relationship.studentId,
      endedAt,
      relationshipEndIdempotencyKey: input.idempotencyKey,
      actorId: input.actorId,
      requestId: input.requestId,
    });

    await incrementAuthorizationEpoch(tx, relationship.parentId);
    await incrementAuthorizationEpoch(tx, relationship.studentId);

    await appendAuditEvent(tx, {
      actorId: input.actorId,
      action: "relationship.ended",
      resourceType: "relationship",
      resourceId: relationship.id,
      requestId: input.requestId,
      idempotencyKey: `audit:rel-end:${input.idempotencyKey}`,
      metadata: {
        familyId: relationship.familyId,
        parentId: relationship.parentId,
        studentId: relationship.studentId,
      },
    });

    await appendOutboxEvent(tx, {
      aggregateType: "relationship",
      aggregateId: relationship.id,
      eventType: "relationship.ended",
      dedupeKey: `outbox:rel-end:${input.idempotencyKey}`,
      payload: {
        relationshipId: relationship.id,
        familyId: relationship.familyId,
        parentId: relationship.parentId,
        studentId: relationship.studentId,
        endedBy: input.actorId,
      },
    });

    return {
      relationshipId: relationship.id,
      status: "ended" as const,
      idempotentReplay: false,
    };
  });
}
