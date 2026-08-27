export type SettlementErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "IDEMPOTENCY_CONFLICT"
  | "STATE_CONFLICT"
  | "NO_ACTIVE_RULE"
  | "VALIDATION_ERROR";

export class SettlementError extends Error {
  readonly code: SettlementErrorCode;

  constructor(code: SettlementErrorCode, message: string) {
    super(message);
    this.name = "SettlementError";
    this.code = code;
  }
}
