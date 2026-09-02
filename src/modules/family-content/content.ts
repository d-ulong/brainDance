import { FamilyContentError } from "@/modules/family-content/errors";
import {
  MAX_ANSWER_BODY_LENGTH,
  MAX_COMMENT_BODY_LENGTH,
  MAX_PUSH_BODY_LENGTH,
  MAX_PUSH_LINK_LENGTH,
} from "@/modules/family-content/constants";

export function normalizePushContent(input: {
  body?: string | null;
  linkUrl?: string | null;
  mediaIds?: string[] | null;
}): {
  body: string;
  linkUrl: string | null;
  mediaIds: string[];
} {
  const body = (input.body ?? "").trim();
  const rawLink = (input.linkUrl ?? "").trim();
  const linkUrl = rawLink.length > 0 ? rawLink : null;
  const mediaIds = [...new Set((input.mediaIds ?? []).filter((id) => typeof id === "string" && id.length > 0))];

  if (body.length === 0 && !linkUrl && mediaIds.length === 0) {
    throw new FamilyContentError("VALIDATION_ERROR", "Push requires text, a link URL, or an image");
  }
  if (body.length > MAX_PUSH_BODY_LENGTH) {
    throw new FamilyContentError("VALIDATION_ERROR", "Push body is too long");
  }
  if (linkUrl && linkUrl.length > MAX_PUSH_LINK_LENGTH) {
    throw new FamilyContentError("VALIDATION_ERROR", "Push link URL is too long");
  }
  if (mediaIds.length > 1) {
    throw new FamilyContentError("VALIDATION_ERROR", "Only one push image is allowed");
  }
  if (linkUrl) {
    assertRawHttpUrl(linkUrl);
  }

  return { body, linkUrl, mediaIds };
}

export function normalizeAnswerContent(input: {
  body?: string | null;
  mediaIds?: string[] | null;
  handwritingMediaIds?: string[] | null;
}): {
  body: string;
  mediaIds: string[];
  handwritingMediaIds: string[];
} {
  const body = (input.body ?? "").trim();
  const mediaIds = [
    ...new Set((input.mediaIds ?? []).filter((id) => typeof id === "string" && id.length > 0)),
  ];
  const handwritingMediaIds = [
    ...new Set(
      (input.handwritingMediaIds ?? []).filter((id) => typeof id === "string" && id.length > 0),
    ),
  ];

  if (body.length === 0 && mediaIds.length === 0 && handwritingMediaIds.length === 0) {
    throw new FamilyContentError("VALIDATION_ERROR", "Answer requires text or an image");
  }
  if (body.length > MAX_ANSWER_BODY_LENGTH) {
    throw new FamilyContentError("VALIDATION_ERROR", "Answer body is too long");
  }
  if (mediaIds.length > 1 || handwritingMediaIds.length > 1) {
    throw new FamilyContentError("VALIDATION_ERROR", "Only one image per answer purpose is allowed");
  }

  return { body, mediaIds, handwritingMediaIds };
}

/** @deprecated Prefer normalizeAnswerContent — kept for text-only callers. */
export function normalizeAnswerBody(body: string): string {
  return normalizeAnswerContent({ body }).body;
}

export function normalizeCommentBody(body: string): string {
  const trimmed = body.trim();
  if (trimmed.length === 0) {
    throw new FamilyContentError("VALIDATION_ERROR", "Comment body is required");
  }
  if (trimmed.length > MAX_COMMENT_BODY_LENGTH) {
    throw new FamilyContentError("VALIDATION_ERROR", "Comment body is too long");
  }
  return trimmed;
}

function assertRawHttpUrl(value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new FamilyContentError("VALIDATION_ERROR", "Link URL is invalid");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new FamilyContentError("VALIDATION_ERROR", "Link URL must be http or https");
  }

  // Reject obvious whitespace / control characters that would not survive a round-trip.
  if (value !== parsed.href && value !== decodeURI(parsed.href)) {
    // Allow exact original string when it is a valid absolute URL; do not rewrite.
    if (!/^https?:\/\/\S+$/i.test(value)) {
      throw new FamilyContentError("VALIDATION_ERROR", "Link URL is invalid");
    }
  }
}
