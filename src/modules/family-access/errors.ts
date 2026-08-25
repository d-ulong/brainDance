export type FamilyAccessErrorCode =
  | "ASSOCIATION_CODE_INVALID"
  | "ASSOCIATION_CODE_EXPIRED"
  | "ASSOCIATION_CODE_CONSUMED"
  | "ASSOCIATION_CODE_REVOKED"
  | "RELATIONSHIP_REQUEST_INVALID"
  | "RELATIONSHIP_REQUEST_EXPIRED"
  | "RELATIONSHIP_REQUEST_NOT_PENDING"
  | "RELATIONSHIP_ALREADY_ACTIVE"
  | "STUDENT_ALREADY_HAS_FAMILY"
  | "CONTACT_NOT_VERIFIED"
  | "FORBIDDEN"
  | "UNAUTHORIZED"
  | "VALIDATION_ERROR"
  | "USER_NOT_FOUND";

export class FamilyAccessError extends Error {
  readonly code: FamilyAccessErrorCode;

  constructor(code: FamilyAccessErrorCode, message: string) {
    super(message);
    this.name = "FamilyAccessError";
    this.code = code;
  }
}
