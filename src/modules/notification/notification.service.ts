import { and, desc, eq, sql } from "drizzle-orm";

import type { Database } from "@/db";
import { notifications } from "@/db/schema";
import type { NotificationDto } from "@/modules/family-content/dto";

export const NOTIFICATION_TYPES = {
  PUBLISHED: "family_push.published",
  ANSWERED: "family_push.answered",
  COMMENTED: "family_push.commented",
} as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES];

const GENERIC_MESSAGES: Record<NotificationType, string> = {
  "family_push.published": "有一条新的家庭推送",
  "family_push.answered": "学生提交了推送作答",
  "family_push.commented": "推送有新的评论",
};

export async function createNotificationIfAbsent(
  db: Database,
  input: {
    recipientUserId: string;
    notificationType: NotificationType;
    resourceType: string;
    resourceId: string;
    actorUserId?: string | null;
    dedupeKey: string;
    now?: Date;
  },
): Promise<string> {
  const [existing] = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(eq(notifications.dedupeKey, input.dedupeKey))
    .limit(1);
  if (existing) {
    return existing.id;
  }

  const [row] = await db
    .insert(notifications)
    .values({
      recipientUserId: input.recipientUserId,
      notificationType: input.notificationType,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      actorUserId: input.actorUserId ?? null,
      dedupeKey: input.dedupeKey,
      createdAt: input.now ?? new Date(),
    })
    .onConflictDoNothing()
    .returning({ id: notifications.id });

  if (row) {
    return row.id;
  }

  const [raced] = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(eq(notifications.dedupeKey, input.dedupeKey))
    .limit(1);
  if (!raced) {
    throw new Error("Failed to create notification");
  }
  return raced.id;
}

export function notificationMessage(type: string): string {
  return GENERIC_MESSAGES[type as NotificationType] ?? "你有一条新的站内通知";
}

export async function listNotificationsForUser(
  db: Database,
  input: { userId: string; limit?: number },
): Promise<NotificationDto[]> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const rows = await db
    .select()
    .from(notifications)
    .where(eq(notifications.recipientUserId, input.userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);

  return rows.map((row) => ({
    notificationId: row.id,
    notificationType: row.notificationType,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    actorUserId: row.actorUserId,
    message: notificationMessage(row.notificationType),
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function markNotificationRead(
  db: Database,
  input: { userId: string; notificationId: string; now?: Date },
): Promise<NotificationDto | null> {
  const [row] = await db
    .update(notifications)
    .set({ readAt: input.now ?? new Date() })
    .where(
      and(
        eq(notifications.id, input.notificationId),
        eq(notifications.recipientUserId, input.userId),
        sql`${notifications.readAt} IS NULL`,
      ),
    )
    .returning();

  if (!row) {
    const [existing] = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.id, input.notificationId),
          eq(notifications.recipientUserId, input.userId),
        ),
      )
      .limit(1);
    if (!existing) {
      return null;
    }
    return {
      notificationId: existing.id,
      notificationType: existing.notificationType,
      resourceType: existing.resourceType,
      resourceId: existing.resourceId,
      actorUserId: existing.actorUserId,
      message: notificationMessage(existing.notificationType),
      readAt: existing.readAt?.toISOString() ?? null,
      createdAt: existing.createdAt.toISOString(),
    };
  }

  return {
    notificationId: row.id,
    notificationType: row.notificationType,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    actorUserId: row.actorUserId,
    message: notificationMessage(row.notificationType),
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
