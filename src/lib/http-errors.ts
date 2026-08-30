import { FamilyAccessError } from "@/modules/family-access/errors";
import { IdentityError } from "@/modules/identity/errors";
import { ReflectionPrivacyError } from "@/modules/reflection-privacy/errors";
import { TrainingError } from "@/modules/training/errors";

export function appErrorToStatus(code: string): number {
  switch (code) {
    case "UNAUTHORIZED":
    case "INVALID_CREDENTIALS":
      return 401;
    case "FORBIDDEN":
    case "ACCOUNT_LOCKED":
    case "CONTACT_NOT_VERIFIED":
    case "PASSWORD_CHANGE_REQUIRED":
      return 403;
    case "INVITATION_INVALID":
    case "INVITATION_EXPIRED":
    case "INVITATION_REVOKED":
    case "INVITATION_EXHAUSTED":
    case "INVITATION_ROLE_MISMATCH":
    case "VERIFICATION_INVALID":
    case "VERIFICATION_EXPIRED":
    case "VALIDATION_ERROR":
    case "CONTACT_ALREADY_USED":
    case "ASSOCIATION_CODE_INVALID":
    case "ASSOCIATION_CODE_EXPIRED":
    case "ASSOCIATION_CODE_CONSUMED":
    case "ASSOCIATION_CODE_REVOKED":
    case "RELATIONSHIP_REQUEST_INVALID":
    case "RELATIONSHIP_REQUEST_EXPIRED":
    case "RELATIONSHIP_REQUEST_NOT_PENDING":
    case "RELATIONSHIP_ALREADY_ACTIVE":
    case "STUDENT_ALREADY_HAS_FAMILY":
    case "TRAINING_DEFINITION_NOT_FOUND":
    case "SESSION_NOT_FOUND":
    case "SESSION_INVALID_STATE":
    case "SESSION_ALREADY_COMPLETED":
    case "EVENT_SEQUENCE_INVALID":
    case "EVENT_PAYLOAD_INVALID":
    case "STUDENT_BIRTH_DATE_REQUIRED":
      return 400;
    case "IDEMPOTENCY_SESSION_MISMATCH":
    case "STATE_CONFLICT":
      return 409;
    case "USER_NOT_FOUND":
    case "RELATIONSHIP_NOT_FOUND":
    case "NOT_FOUND":
      return 404;
    case "RELATIONSHIP_NOT_ACTIVE":
    case "REFLECTION_NOT_TODAY":
    case "REFLECTION_DELETED":
      return 400;
    default:
      return 400;
  }
}

export function identityErrorToStatus(code: IdentityError["code"]): number {
  return appErrorToStatus(code);
}

export function toErrorResponse(error: unknown): {
  status: number;
  body: { error: string; code?: string };
} {
  if (
    error instanceof IdentityError ||
    error instanceof FamilyAccessError ||
    error instanceof ReflectionPrivacyError ||
    error instanceof TrainingError
  ) {
    return {
      status: appErrorToStatus(error.code),
      body: { error: error.message, code: error.code },
    };
  }

  return {
    status: 500,
    body: { error: "Internal server error" },
  };
}
