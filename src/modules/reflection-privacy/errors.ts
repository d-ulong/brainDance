export type ReflectionPrivacyErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "VALIDATION_ERROR"
  | "STATE_CONFLICT"
  | "IDEMPOTENCY_CONFLICT"
  | "REFLECTION_NOT_TODAY"
  | "REFLECTION_DELETED";

export class ReflectionPrivacyError extends Error {
  readonly code: ReflectionPrivacyErrorCode;

  constructor(code: ReflectionPrivacyErrorCode, message: string) {
    super(message);
    this.name = "ReflectionPrivacyError";
    this.code = code;
  }
}
