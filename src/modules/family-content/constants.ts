export const FAMILY_PUSH_STATUSES = [
  "draft",
  "scheduled",
  "published",
  "disabled",
  "deleted",
  "cancelled",
] as const;

export type FamilyPushStatus = (typeof FAMILY_PUSH_STATUSES)[number];

export const FAMILY_PUSH_PUBLISH_MODES = ["draft", "immediate", "scheduled"] as const;
export type FamilyPushPublishMode = (typeof FAMILY_PUSH_PUBLISH_MODES)[number];

export const FAMILY_CONTENT_EVENT_TYPES = {
  PUBLISH_REQUESTED: "family_push.publish_requested",
  PUBLISHED: "family_push.published",
  CANCELLED: "family_push.cancelled",
  ANSWERED: "family_push.answered",
  COMMENTED: "family_push.commented",
} as const;

export const MAX_PUSH_BODY_LENGTH = 10_000;
export const MAX_PUSH_LINK_LENGTH = 2_048;
export const MAX_ANSWER_BODY_LENGTH = 10_000;
export const MAX_COMMENT_BODY_LENGTH = 4_000;

export const UNPUBLISHED_EDITABLE_STATUSES: ReadonlySet<FamilyPushStatus> = new Set([
  "draft",
  "scheduled",
]);

export const READABLE_STATUSES_FOR_FAMILY: ReadonlySet<FamilyPushStatus> = new Set([
  "draft",
  "scheduled",
  "published",
  "disabled",
]);

export const STUDENT_READABLE_STATUSES: ReadonlySet<FamilyPushStatus> = new Set([
  "published",
  "disabled",
]);

export const ANSWERABLE_STATUSES: ReadonlySet<FamilyPushStatus> = new Set(["published"]);
export const COMMENTABLE_STATUSES: ReadonlySet<FamilyPushStatus> = new Set(["published"]);
