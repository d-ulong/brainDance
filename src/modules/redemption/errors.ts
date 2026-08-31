export type RedemptionErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "VALIDATION_ERROR"
  | "IDEMPOTENCY_CONFLICT"
  | "STATE_CONFLICT"
  | "INSUFFICIENT_BALANCE"
  | "MONTHLY_LIMIT_EXCEEDED"
  | "CATALOG_INACTIVE";

export class RedemptionError extends Error {
  readonly code: RedemptionErrorCode;

  constructor(code: RedemptionErrorCode, message: string) {
    super(message);
    this.name = "RedemptionError";
    this.code = code;
  }
}
