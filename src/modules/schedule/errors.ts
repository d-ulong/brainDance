export type ScheduleErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "IDEMPOTENCY_CONFLICT"
  | "STATE_CONFLICT"
  | "WINDOW_EXPIRED"
  | "SLOT_INVARIANT";

export class ScheduleError extends Error {
  readonly code: ScheduleErrorCode;

  constructor(code: ScheduleErrorCode, message: string) {
    super(message);
    this.name = "ScheduleError";
    this.code = code;
  }
}
