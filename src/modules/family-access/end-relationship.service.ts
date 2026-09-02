import { eq, sql } from "drizzle-orm";

import type { Database } from "@/db";
import { auditEvents, relationships, users } from "@/db/schema";
import { appendAuditEvent } from "@/modules/audit/append-audit-event";
import { deactivateCreatorConfigsOnRelationshipEnd } from "@/modules/family-access/deactivate-creator-configs.service";
import { FamilyAccessError } from "@/modules/family-access/errors";
import { reconcileMembershipAfterRelationshipEnd } from "@/modules/family-access/membership-projection.service";
import { appendOutboxEvent } from "@/modules/outbox/append-outbox-event";
import { cancelScheduledPushesOnRelationshipEnd } from "@/modules/family-content/push-lifecycle.service";
import { revokePrivateGrantsOnRelationshipEnd } from "@/modules/reflection-privacy/grant-private-access.service";
import { assertStudentAccountNotFrozen } from "@/modules/data-lifecycle/freeze-guard.service";

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

async function lockUsersInOrder(tx: Database, userIds: string[]) {
  const ordered = [...new Set(userIds)].sort();
  for (const userId of ordered) {
    await tx.execute(sql`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`);
  }
}

async function incrementAuthorizationEpoch(tx: Database, userId: string) {
  const [updated] = await tx
    .update(users)
    .set({
      authorizationEpoch: sql`${users.authorizationEpoch} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId))
    .returning({ id: users.id });

  if (!updated) {
    throw new FamilyAccessError("USER_NOT_FOUND", "User not found");
  }
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

    await assertStudentAccountNotFrozen(tx, relationship.studentId, "write");

    await lockUsersInOrder(tx, [relationship.parentId, relationship.studentId]);

    const endedAt = new Date();
    const memberUserIds = [relationship.parentId, relationship.studentId].sort();

    await tx
      .update(relationships)
      .set({
        status: "ended",
        endedAt,
        endedBy: input.actorId,
      })
      .where(eq(relationships.id, input.relationshipId));

    for (const userId of memberUserIds) {
      await reconcileMembershipAfterRelationshipEnd(tx, {
        familyId: relationship.familyId,
        userId,
        endedAt,
      });
    }

    await deactivateCreatorConfigsOnRelationshipEnd(tx, {
      parentId: relationship.parentId,
      studentId: relationship.studentId,
      endedAt,
      relationshipEndIdempotencyKey: input.idempotencyKey,
      actorId: input.actorId,
      requestId: input.requestId,
    });

    await revokePrivateGrantsOnRelationshipEnd(tx, {
      parentId: relationship.parentId,
      studentId: relationship.studentId,
      actorId: input.actorId,
      relationshipEndIdempotencyKey: input.idempotencyKey,
      requestId: input.requestId,
    });

    await cancelScheduledPushesOnRelationshipEnd(tx, {
      parentId: relationship.parentId,
      studentId: relationship.studentId,
      endedAt,
      relationshipEndIdempotencyKey: input.idempotencyKey,
      actorId: input.actorId,
      requestId: input.requestId,
    });

    for (const userId of memberUserIds) {
      await incrementAuthorizationEpoch(tx, userId);
    }

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
