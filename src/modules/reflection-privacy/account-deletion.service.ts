import { and, eq, isNull } from "drizzle-orm";

import type { Database } from "@/db";
import { dailyReflections, privateAccessGrants } from "@/db/schema";
import { PRIVATE_RESOURCE_TYPES } from "@/modules/reflection-privacy/constants";

export async function purgeAllReflectionBodiesForStudent(
  tx: Database,
  input: { studentId: string; now: Date },
): Promise<number> {
  const result = await tx
    .update(dailyReflections)
    .set({ body: "", deletedAt: input.now, bodyPurgedAt: input.now, updatedAt: input.now })
    .where(eq(dailyReflections.studentId, input.studentId))
    .returning({ id: dailyReflections.id });

  return result.length;
}

export async function purgeReflectionBodyById(
  tx: Database,
  input: { reflectionId: string; now: Date },
): Promise<boolean> {
  const result = await tx
    .update(dailyReflections)
    .set({ body: "", deletedAt: input.now, bodyPurgedAt: input.now, updatedAt: input.now })
    .where(eq(dailyReflections.id, input.reflectionId))
    .returning({ id: dailyReflections.id });

  return result.length > 0;
}

export async function revokePrivateGrantsForReflection(
  tx: Database,
  input: { reflectionId: string; now: Date },
): Promise<number> {
  const result = await tx
    .update(privateAccessGrants)
    .set({ revokedAt: input.now })
    .where(
      and(
        eq(privateAccessGrants.resourceId, input.reflectionId),
        eq(privateAccessGrants.resourceType, PRIVATE_RESOURCE_TYPES.DAILY_REFLECTION),
        isNull(privateAccessGrants.revokedAt),
      ),
    )
    .returning({ id: privateAccessGrants.id });

  return result.length;
}

export async function replayReflectionBodiesTombstoneForStudent(
  tx: Database,
  input: { studentId: string; purgedAt: Date },
): Promise<number> {
  const reflections = await tx
    .select({
      id: dailyReflections.id,
      body: dailyReflections.body,
      deletedAt: dailyReflections.deletedAt,
    })
    .from(dailyReflections)
    .where(eq(dailyReflections.studentId, input.studentId));

  let applied = 0;

  for (const reflection of reflections) {
    if (!reflection.deletedAt || reflection.body.length > 0) {
      await tx
        .update(dailyReflections)
        .set({
          body: "",
          deletedAt: input.purgedAt,
          bodyPurgedAt: input.purgedAt,
          updatedAt: input.purgedAt,
        })
        .where(eq(dailyReflections.id, reflection.id));
      applied += 1;
    }
  }

  return applied;
}

export async function replayReflectionBodyTombstoneById(
  tx: Database,
  input: { reflectionId: string; purgedAt: Date },
): Promise<boolean> {
  const [reflection] = await tx
    .select({ body: dailyReflections.body, deletedAt: dailyReflections.deletedAt })
    .from(dailyReflections)
    .where(eq(dailyReflections.id, input.reflectionId))
    .limit(1);

  if (!reflection || (!reflection.deletedAt && reflection.body.length === 0)) {
    return false;
  }

  if (reflection.deletedAt && reflection.body.length === 0) {
    return false;
  }

  await tx
    .update(dailyReflections)
    .set({
      body: "",
      deletedAt: input.purgedAt,
      bodyPurgedAt: input.purgedAt,
      updatedAt: input.purgedAt,
    })
    .where(eq(dailyReflections.id, input.reflectionId));

  return true;
}

export async function revokeAllPrivateGrantsForStudent(
  tx: Database,
  input: { studentId: string; now: Date },
): Promise<number> {
  const reflections = await tx
    .select({ id: dailyReflections.id })
    .from(dailyReflections)
    .where(eq(dailyReflections.studentId, input.studentId));

  let revoked = 0;

  for (const reflection of reflections) {
    revoked += await revokePrivateGrantsForReflection(tx, {
      reflectionId: reflection.id,
      now: input.now,
    });
  }

  return revoked;
}

export async function replayPrivateGrantRevocationForStudent(
  tx: Database,
  input: { studentId: string; purgedAt: Date },
): Promise<number> {
  const grants = await tx
    .select({ id: privateAccessGrants.id, resourceId: privateAccessGrants.resourceId })
    .from(privateAccessGrants)
    .innerJoin(dailyReflections, eq(privateAccessGrants.resourceId, dailyReflections.id))
    .where(
      and(eq(dailyReflections.studentId, input.studentId), isNull(privateAccessGrants.revokedAt)),
    );

  let revoked = 0;

  for (const grant of grants) {
    await tx
      .update(privateAccessGrants)
      .set({ revokedAt: input.purgedAt })
      .where(eq(privateAccessGrants.id, grant.id));
    revoked += 1;
  }

  return revoked;
}
