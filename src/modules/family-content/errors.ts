export type FamilyContentErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "VALIDATION_ERROR"
  | "IDEMPOTENCY_CONFLICT"
  | "STATE_CONFLICT"
  | "FROZEN"
  | "MEDIA_REJECTED"
  | "MEDIA_UNAVAILABLE"
  | "TOKEN_INVALID"
  | "TOKEN_EXPIRED";

export class FamilyContentError extends Error {
  readonly code: FamilyContentErrorCode;

  constructor(code: FamilyContentErrorCode, message: string) {
    super(message);
    this.name = "FamilyContentError";
    this.code = code;
  }
}
