export type IdentityErrorCode =
  | "INVITATION_INVALID"
  | "INVITATION_EXPIRED"
  | "INVITATION_REVOKED"
  | "INVITATION_EXHAUSTED"
  | "INVITATION_ROLE_MISMATCH"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "ACCOUNT_LOCKED"
  | "INVALID_CREDENTIALS"
  | "CONTACT_ALREADY_USED"
  | "VERIFICATION_INVALID"
  | "VERIFICATION_EXPIRED"
  | "USER_NOT_FOUND"
  | "CONTACT_NOT_VERIFIED"
  | "VALIDATION_ERROR"
  | "PASSWORD_CHANGE_REQUIRED";

export class IdentityError extends Error {
  readonly code: IdentityErrorCode;

  constructor(code: IdentityErrorCode, message: string) {
    super(message);
    this.name = "IdentityError";
    this.code = code;
  }
}
