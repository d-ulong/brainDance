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
  answerDisclosureDays: number | null;
  canEdit: boolean;
  createdAt: string;
  updatedAt: string;
  /** Present on list responses: whether the scoped student has answered. */
  answered?: boolean;
  answerCount?: number;
  commentCount?: number;
};

export type PushAnswerDto = {
  answerId: string;
  pushId: string;
  studentId: string;
  authorName: string;
  currentVersion: number;
  body: string;
  media: MediaAttachmentDto[];
  edited?: boolean;
  canEdit?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PushCommentDto = {
  commentId: string;
  pushId: string;
  authorId: string;
  authorName: string;
  parentCommentId: string | null;
  quotedAnswerId: string | null;
  quotedCommentId: string | null;
  reference: {
    kind: "reply" | "quoted_comment" | "quoted_answer";
    authorName: string;
    body: string;
  } | null;
  currentVersion: number;
  body: string | null;
  deleted: boolean;
  canEdit: boolean;
  createdAt: string;
  updatedAt: string;
};
