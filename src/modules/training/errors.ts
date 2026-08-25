export type TrainingErrorCode =
  | "FORBIDDEN"
  | "USER_NOT_FOUND"
  | "TRAINING_DEFINITION_NOT_FOUND"
  | "SESSION_NOT_FOUND"
  | "SESSION_INVALID_STATE"
  | "SESSION_ALREADY_COMPLETED"
  | "EVENT_SEQUENCE_INVALID"
  | "EVENT_PAYLOAD_INVALID"
  | "STUDENT_BIRTH_DATE_REQUIRED"
  | "IDEMPOTENCY_SESSION_MISMATCH"
  | "VALIDATION_ERROR";

export class TrainingError extends Error {
  readonly code: TrainingErrorCode;

  constructor(code: TrainingErrorCode, message: string) {
    super(message);
    this.name = "TrainingError";
    this.code = code;
  }
}
