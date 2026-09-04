import { IdentityError } from "@/modules/identity/errors";

export const PRODUCT_PASSWORD_MIN_LENGTH = 6;
export const PRODUCT_PASSWORD_MAX_LENGTH = 12;

/** Stable, non-sensitive rule copy for UI and API validation errors. */
export const PRODUCT_PASSWORD_RULE_DESCRIPTION =
  "密码须为 6–12 位，且同时包含大写字母、小写字母和数字；特殊字符可选";

const HAS_UPPER = /[A-Z]/;
const HAS_LOWER = /[a-z]/;
const HAS_DIGIT = /[0-9]/;

export function isProductPasswordValid(password: string): boolean {
  return (
    password.length >= PRODUCT_PASSWORD_MIN_LENGTH &&
    password.length <= PRODUCT_PASSWORD_MAX_LENGTH &&
    HAS_UPPER.test(password) &&
    HAS_LOWER.test(password) &&
    HAS_DIGIT.test(password)
  );
}

/**
 * Single identity-module authority for product password writes.
 * Call before hashPassword / user table writes.
 */
export function assertProductPassword(password: string): void {
  if (!isProductPasswordValid(password)) {
    throw new IdentityError("VALIDATION_ERROR", PRODUCT_PASSWORD_RULE_DESCRIPTION);
  }
}
