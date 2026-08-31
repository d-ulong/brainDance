export type DataLifecycleErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "VALIDATION_ERROR"
  | "STATE_CONFLICT"
  | "IDEMPOTENCY_CONFLICT"
  | "FROZEN"
  | "TOKEN_EXPIRED"
  | "TOKEN_CONSUMED"
  | "TOKEN_INVALID"
  | "ARTIFACT_UNAVAILABLE"
  | "REVOCATION_EXPIRED"
  | "CONFIRMATION_REQUIRED";

export class DataLifecycleError extends Error {
  constructor(
    public readonly code: DataLifecycleErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DataLifecycleError";
  }
}
