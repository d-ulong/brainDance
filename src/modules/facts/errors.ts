export type FactsErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "IDEMPOTENCY_CONFLICT"
  | "STATE_CONFLICT"
  | "VALIDATION_ERROR"
  | "WINDOW_EXPIRED"
  | "NOT_CONFIRMED";

export class FactsError extends Error {
  readonly code: FactsErrorCode;

  constructor(code: FactsErrorCode, message: string) {
    super(message);
    this.name = "FactsError";
    this.code = code;
  }
}
