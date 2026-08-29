import { and, eq, isNull, sql } from "drizzle-orm";

import type { Database } from "@/db";
import { familyMemberships, relationships } from "@/db/schema";

export async function countActiveRelationshipsInFamilyForUser(
  tx: Database,
  familyId: string,
  userId: string,
): Promise<number> {
  const rows = await tx
    .select({ id: relationships.id })
    .from(relationships)
    .where(
      and(
        eq(relationships.familyId, familyId),
        eq(relationships.status, "active"),
        sql`(${relationships.parentId} = ${userId} OR ${relationships.studentId} = ${userId})`,
      ),
    );

  return rows.length;
}

export async function ensureActiveMembership(
  tx: Database,
  input: {
    familyId: string;
    userId: string;
    memberRole: "parent" | "student";
    relationshipId: string;
    joinedAt: Date;
  },
): Promise<void> {
  const [existing] = await tx
    .select({ id: familyMemberships.id })
    .from(familyMemberships)
    .where(
      and(
        eq(familyMemberships.familyId, input.familyId),
        eq(familyMemberships.userId, input.userId),
        isNull(familyMemberships.leftAt),
      ),
    )
    .limit(1);

  if (existing) {
    return;
  }

  await tx.insert(familyMemberships).values({
    familyId: input.familyId,
    userId: input.userId,
    memberRole: input.memberRole,
    joinedAt: input.joinedAt,
    derivedFromRelationshipId: input.relationshipId,
  });
}

export async function reconcileMembershipAfterRelationshipEnd(
  tx: Database,
  input: {
    familyId: string;
    userId: string;
    endedAt: Date;
  },
): Promise<void> {
  await tx.execute(sql`SELECT id FROM users WHERE id = ${input.userId} FOR UPDATE`);

  const remaining = await countActiveRelationshipsInFamilyForUser(tx, input.familyId, input.userId);

  if (remaining > 0) {
    return;
  }

  await tx
    .update(familyMemberships)
    .set({ leftAt: input.endedAt })
    .where(
      and(
        eq(familyMemberships.familyId, input.familyId),
        eq(familyMemberships.userId, input.userId),
        isNull(familyMemberships.leftAt),
      ),
    );
}
