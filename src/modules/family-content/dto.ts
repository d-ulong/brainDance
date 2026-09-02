export type MediaAttachmentDto = {
  referenceId: string;
  mediaId: string;
  purpose: string;
  status: string;
  detectedMime: string | null;
  width: number | null;
  height: number | null;
};

export type FamilyPushDto = {
  pushId: string;
  studentId: string;
  creatorParentId: string;
  status: string;
  currentVersion: number;
  body: string;
  linkUrl: string | null;
  media: MediaAttachmentDto[];
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
  media: MediaAttachmentDto[];
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
