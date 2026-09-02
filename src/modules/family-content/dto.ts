export type FamilyPushDto = {
  pushId: string;
  studentId: string;
  creatorParentId: string;
  status: string;
  currentVersion: number;
  body: string;
  linkUrl: string | null;
  scheduledPublishAt: string | null;
  publishedAt: string | null;
  canEdit: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PushAnswerDto = {
  answerId: string;
  pushId: string;
  studentId: string;
  currentVersion: number;
  body: string;
  updatedAt: string;
};

export type PushCommentDto = {
  commentId: string;
  pushId: string;
  authorId: string;
  parentCommentId: string | null;
  currentVersion: number;
  body: string | null;
  deleted: boolean;
  canEdit: boolean;
  createdAt: string;
  updatedAt: string;
};

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
