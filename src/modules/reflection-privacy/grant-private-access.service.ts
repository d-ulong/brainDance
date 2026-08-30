import { and, eq, isNull, sql } from "drizzle-orm";

import type { Database } from "@/db";
import { auditEvents, dailyReflections, privateAccessGrants, users } from "@/db/schema";
import { appendAuditEvent } from "@/modules/audit/append-audit-event";
import { hasActiveRelationship } from "@/modules/family-access/authorization.service";
import { appendOutboxEvent } from "@/modules/outbox/append-outbox-event";
import { PRIVATE_RESOURCE_TYPES } from "@/modules/reflection-privacy/constants";
import { ReflectionPrivacyError } from "@/modules/reflection-privacy/errors";
import {
  findReflectionByStudentDate,
  type ReflectionGrantDto,
} from "@/modules/reflection-privacy/get-daily-reflection.service";

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
    throw new ReflectionPrivacyError("NOT_FOUND", "User not found");
  }
}

async function findGrantReplay(
  db: Database,
  idempotencyKey: string,
  action: "grant" | "revoke",
): Promise<string | null> {
  const auditKey = `audit:private_access.${action}:${idempotencyKey}`;
  const [existing] = await db
    .select({ resourceId: auditEvents.resourceId })
    .from(auditEvents)
    .where(eq(auditEvents.idempotencyKey, auditKey))
    .limit(1);

  return existing?.resourceId ?? null;
}

export type GrantPrivateAccessInput = {
  studentId: string;
  familyDate: string;
  parentId: string;
  idempotencyKey: string;
  requestId?: string;
};

export type GrantPrivateAccessResult = {
  grantId: string;
  parentId: string;
  idempotentReplay: boolean;
  parentEpochChanged: boolean;
};

export async function grantPrivateAccess(
  db: Database,
  input: GrantPrivateAccessInput,
): Promise<GrantPrivateAccessResult> {
  const replayGrantId = await findGrantReplay(db, input.idempotencyKey, "grant");
  if (replayGrantId) {
    return {
      grantId: replayGrantId,
      parentId: input.parentId,
      idempotentReplay: true,
      parentEpochChanged: false,
    };
  }

  return db.transaction(async (tx) => {
    const replayInTx = await findGrantReplay(tx, input.idempotencyKey, "grant");
    if (replayInTx) {
      return {
        grantId: replayInTx,
        parentId: input.parentId,
        idempotentReplay: true,
        parentEpochChanged: false,
      };
    }

    const reflection = await findReflectionByStudentDate(tx, input.studentId, input.familyDate);
    if (!reflection) {
      throw new ReflectionPrivacyError("NOT_FOUND", "Daily reflection not found");
    }
    if (reflection.visibility !== "private") {
      throw new ReflectionPrivacyError("STATE_CONFLICT", "Only private reflections can be granted");
    }

    const active = await hasActiveRelationship(tx, input.parentId, input.studentId);
    if (!active) {
      throw new ReflectionPrivacyError("FORBIDDEN", "Parent has no active relationship");
    }

    await tx.execute(
      sql`SELECT id FROM users WHERE id IN (${input.studentId}, ${input.parentId}) ORDER BY id FOR UPDATE`,
    );

    const [existingGrant] = await tx
      .select()
      .from(privateAccessGrants)
      .where(
        and(
          eq(privateAccessGrants.resourceType, PRIVATE_RESOURCE_TYPES.DAILY_REFLECTION),
          eq(privateAccessGrants.resourceId, reflection.id),
          eq(privateAccessGrants.parentId, input.parentId),
          isNull(privateAccessGrants.revokedAt),
        ),
      )
      .limit(1);

    if (existingGrant) {
      await appendAuditEvent(tx, {
        actorId: input.studentId,
        action: "private_access.grant",
        resourceType: "private_access_grant",
        resourceId: existingGrant.id,
        requestId: input.requestId,
        idempotencyKey: `audit:private_access.grant:${input.idempotencyKey}`,
        metadata: {
          reflectionId: reflection.id,
          parentId: input.parentId,
        },
      });
      return {
        grantId: existingGrant.id,
        parentId: input.parentId,
        idempotentReplay: true,
        parentEpochChanged: false,
      };
    }

    const [created] = await tx
      .insert(privateAccessGrants)
      .values({
        resourceType: PRIVATE_RESOURCE_TYPES.DAILY_REFLECTION,
        resourceId: reflection.id,
        parentId: input.parentId,
        grantIdempotencyKey: input.idempotencyKey,
      })
      .returning();

    if (!created) {
      throw new ReflectionPrivacyError("STATE_CONFLICT", "Failed to create grant");
    }

    await incrementAuthorizationEpoch(tx, input.parentId);

    await appendAuditEvent(tx, {
      actorId: input.studentId,
      action: "private_access.grant",
      resourceType: "private_access_grant",
      resourceId: created.id,
      requestId: input.requestId,
      idempotencyKey: `audit:private_access.grant:${input.idempotencyKey}`,
      metadata: {
        reflectionId: reflection.id,
        parentId: input.parentId,
      },
    });

    await appendOutboxEvent(tx, {
      aggregateType: "private_access_grant",
      aggregateId: created.id,
      eventType: "private_access.granted",
      dedupeKey: `outbox:private_access.grant:${input.idempotencyKey}`,
      payload: {
        grantId: created.id,
        reflectionId: reflection.id,
        parentId: input.parentId,
        studentId: input.studentId,
      },
    });

    return {
      grantId: created.id,
      parentId: input.parentId,
      idempotentReplay: false,
      parentEpochChanged: true,
    };
  });
}

export type RevokePrivateAccessInput = {
  studentId: string;
  familyDate: string;
  parentId: string;
  idempotencyKey: string;
  requestId?: string;
};

export type RevokePrivateAccessResult = {
  grantId: string | null;
  parentId: string;
  idempotentReplay: boolean;
  parentEpochChanged: boolean;
};

export async function revokePrivateAccess(
  db: Database,
  input: RevokePrivateAccessInput,
): Promise<RevokePrivateAccessResult> {
  const replayGrantId = await findGrantReplay(db, input.idempotencyKey, "revoke");
  if (replayGrantId) {
    return {
      grantId: replayGrantId,
      parentId: input.parentId,
      idempotentReplay: true,
      parentEpochChanged: false,
    };
  }

  return db.transaction(async (tx) => {
    const replayInTx = await findGrantReplay(tx, input.idempotencyKey, "revoke");
    if (replayInTx) {
      return {
        grantId: replayInTx,
        parentId: input.parentId,
        idempotentReplay: true,
        parentEpochChanged: false,
      };
    }

    const reflection = await findReflectionByStudentDate(tx, input.studentId, input.familyDate);
    if (!reflection) {
      throw new ReflectionPrivacyError("NOT_FOUND", "Daily reflection not found");
    }

    await tx.execute(
      sql`SELECT id FROM users WHERE id IN (${input.studentId}, ${input.parentId}) ORDER BY id FOR UPDATE`,
    );

    const [activeGrant] = await tx
      .select()
      .from(privateAccessGrants)
      .where(
        and(
          eq(privateAccessGrants.resourceType, PRIVATE_RESOURCE_TYPES.DAILY_REFLECTION),
          eq(privateAccessGrants.resourceId, reflection.id),
          eq(privateAccessGrants.parentId, input.parentId),
          isNull(privateAccessGrants.revokedAt),
        ),
      )
      .limit(1);

    if (!activeGrant) {
      throw new ReflectionPrivacyError("NOT_FOUND", "Active grant not found");
    }

    const revokedAt = new Date();
    await tx
      .update(privateAccessGrants)
      .set({
        revokedAt,
        revokeIdempotencyKey: input.idempotencyKey,
      })
      .where(eq(privateAccessGrants.id, activeGrant.id));

    await incrementAuthorizationEpoch(tx, input.parentId);

    await appendAuditEvent(tx, {
      actorId: input.studentId,
      action: "private_access.revoke",
      resourceType: "private_access_grant",
      resourceId: activeGrant.id,
      requestId: input.requestId,
      idempotencyKey: `audit:private_access.revoke:${input.idempotencyKey}`,
      metadata: {
        reflectionId: reflection.id,
        parentId: input.parentId,
      },
    });

    await appendOutboxEvent(tx, {
      aggregateType: "private_access_grant",
      aggregateId: activeGrant.id,
      eventType: "private_access.revoked",
      dedupeKey: `outbox:private_access.revoke:${input.idempotencyKey}`,
      payload: {
        grantId: activeGrant.id,
        reflectionId: reflection.id,
        parentId: input.parentId,
        studentId: input.studentId,
      },
    });

    return {
      grantId: activeGrant.id,
      parentId: input.parentId,
      idempotentReplay: false,
      parentEpochChanged: true,
    };
  });
}

export async function revokePrivateGrantsOnRelationshipEnd(
  tx: Database,
  input: {
    parentId: string;
    studentId: string;
    actorId: string;
    relationshipEndIdempotencyKey: string;
    requestId?: string;
  },
): Promise<{ revokedCount: number; grantIds: string[] }> {
  const reflectionRows = await tx
    .select({ id: dailyReflections.id })
    .from(dailyReflections)
    .where(
      and(eq(dailyReflections.studentId, input.studentId), isNull(dailyReflections.deletedAt)),
    );

  if (reflectionRows.length === 0) {
    return { revokedCount: 0, grantIds: [] };
  }

  const reflectionIds = reflectionRows.map((row) => row.id);
  const revokedAt = new Date();
  const grantIds: string[] = [];

  for (const reflectionId of reflectionIds) {
    const activeGrants = await tx
      .select()
      .from(privateAccessGrants)
      .where(
        and(
          eq(privateAccessGrants.resourceType, PRIVATE_RESOURCE_TYPES.DAILY_REFLECTION),
          eq(privateAccessGrants.resourceId, reflectionId),
          eq(privateAccessGrants.parentId, input.parentId),
          isNull(privateAccessGrants.revokedAt),
        ),
      );

    for (const grant of activeGrants) {
      await tx
        .update(privateAccessGrants)
        .set({
          revokedAt,
          revokeIdempotencyKey: `rel-end:${input.relationshipEndIdempotencyKey}:${grant.id}`,
        })
        .where(eq(privateAccessGrants.id, grant.id));

      grantIds.push(grant.id);

      await appendAuditEvent(tx, {
        actorId: input.actorId,
        action: "private_access.revoke",
        resourceType: "private_access_grant",
        resourceId: grant.id,
        requestId: input.requestId,
        idempotencyKey: `audit:rel-end-grant-revoke:${input.relationshipEndIdempotencyKey}:${grant.id}`,
        metadata: {
          reflectionId,
          parentId: input.parentId,
          reason: "relationship.ended",
        },
      });

      await appendOutboxEvent(tx, {
        aggregateType: "private_access_grant",
        aggregateId: grant.id,
        eventType: "private_access.revoked",
        dedupeKey: `outbox:rel-end-grant-revoke:${input.relationshipEndIdempotencyKey}:${grant.id}`,
        payload: {
          grantId: grant.id,
          reflectionId,
          parentId: input.parentId,
          studentId: input.studentId,
          reason: "relationship.ended",
        },
      });
    }
  }

  return { revokedCount: grantIds.length, grantIds };
}

export type { ReflectionGrantDto };
