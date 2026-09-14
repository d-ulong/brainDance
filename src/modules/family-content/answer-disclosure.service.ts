import { eq } from "drizzle-orm";

import type { Database } from "@/db";
import { familyPushes } from "@/db/schema/family-content";
import { pushLibraryDeliveries } from "@/db/schema/push-library";

export type RelatedPush = {
  id: string;
  studentId: string;
  publishedAt: Date | null;
  answerDisclosureDays: number | null;
};

export async function relatedPushesForStudentRead(db: Database, pushId: string): Promise<RelatedPush[]> {
  const [delivery] = await db.select().from(pushLibraryDeliveries).where(eq(pushLibraryDeliveries.pushId, pushId)).limit(1);
  if (!delivery) {
    return db.select({ id: familyPushes.id, studentId: familyPushes.studentId, publishedAt: familyPushes.publishedAt, answerDisclosureDays: familyPushes.answerDisclosureDays }).from(familyPushes).where(eq(familyPushes.id, pushId));
  }
  return db.select({ id: familyPushes.id, studentId: familyPushes.studentId, publishedAt: familyPushes.publishedAt, answerDisclosureDays: familyPushes.answerDisclosureDays })
    .from(pushLibraryDeliveries)
    .innerJoin(familyPushes, eq(familyPushes.id, pushLibraryDeliveries.pushId))
    .where(eq(pushLibraryDeliveries.publicationId, delivery.publicationId));
}

export function isAnswerDisclosed(push: RelatedPush, viewerStudentId: string, now = new Date()): boolean {
  if (push.studentId === viewerStudentId) return true;
  if (!push.publishedAt) return false;
  if (push.answerDisclosureDays === null) return true;
  return now.getTime() >= push.publishedAt.getTime() + push.answerDisclosureDays * 86_400_000;
}
