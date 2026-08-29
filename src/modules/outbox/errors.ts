export type OutboxErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "LEASE_MISMATCH"
  | "STATE_CONFLICT"
  | "IDEMPOTENCY_CONFLICT"
  | "MAX_ATTEMPTS_EXCEEDED"
  | "UNSUPPORTED_EVENT";

export class OutboxError extends Error {
  readonly code: OutboxErrorCode;

  constructor(code: OutboxErrorCode, message: string) {
    super(message);
    this.name = "OutboxError";
    this.code = code;
  }
}
