export type NotificationDto = {
  notificationId: string;
  notificationType: string;
  resourceType: string;
  resourceId: string;
  actorUserId: string | null;
  message: string;
  readAt: string | null;
  createdAt: string;
};
