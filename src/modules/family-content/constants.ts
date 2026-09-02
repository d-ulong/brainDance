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
  MEDIA_PURGE_REQUESTED: "family_media.purge_requested",
} as const;

export const MEDIA_OBJECT_STATUSES = [
  "staging",
  "processing",
  "ready",
  "rejected",
  "revoked",
  "purged",
] as const;

export type MediaObjectStatus = (typeof MEDIA_OBJECT_STATUSES)[number];

export const MEDIA_SCAN_RESULTS = ["pending", "clean", "rejected", "error"] as const;
export type MediaScanResultStatus = (typeof MEDIA_SCAN_RESULTS)[number];

export const MEDIA_RESOURCE_TYPES = ["family_push_version", "push_answer_version"] as const;
export type MediaResourceType = (typeof MEDIA_RESOURCE_TYPES)[number];

export const MEDIA_PURPOSES = ["push_image", "answer_image", "handwriting_image"] as const;
export type MediaPurpose = (typeof MEDIA_PURPOSES)[number];

export const MEDIA_PURGE_INTENT_STATUSES = ["pending", "completed", "dead"] as const;
export type MediaPurgeIntentStatus = (typeof MEDIA_PURGE_INTENT_STATUSES)[number];

export const ALLOWED_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;
export type AllowedMediaMime = (typeof ALLOWED_MIMES)[number];

export const MAX_PUSH_BODY_LENGTH = 10_000;
export const MAX_PUSH_LINK_LENGTH = 2_048;
export const MAX_ANSWER_BODY_LENGTH = 10_000;
export const MAX_COMMENT_BODY_LENGTH = 4_000;
export const MAX_MEDIA_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 40_000_000;
export const MAX_IMAGE_DIMENSION = 8192;
export const MEDIA_READ_TTL_MS = 5 * 60 * 1000;
export const MEDIA_PURGE_DAYS = 90;

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
