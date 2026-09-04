import { describe, expect, it } from "vitest";

import {
  assertProductPassword,
  isProductPasswordValid,
  PRODUCT_PASSWORD_RULE_DESCRIPTION,
} from "@/modules/identity/password-policy";

describe("product password policy", () => {
  it("accepts Abc123 and other 6-12 compliant passwords", () => {
    expect(isProductPasswordValid("Abc123")).toBe(true);
    expect(isProductPasswordValid("Parent1aXy")).toBe(true);
    expect(isProductPasswordValid("A1bcde")).toBe(true);
    expect(isProductPasswordValid("Abcd1234!@#")).toBe(true);
    expect(() => assertProductPassword("Abc123")).not.toThrow();
  });

  it("rejects length, uppercase, lowercase, and digit failures", () => {
    const cases = [
      "Ab1", // too short
      "Abcdefghijkl1", // 13 chars, too long
      "abcdef1", // missing upper
      "ABCDEF1", // missing lower
      "Abcdefg", // missing digit
    ];

    for (const password of cases) {
      expect(isProductPasswordValid(password)).toBe(false);
      expect(() => assertProductPassword(password)).toThrowError(
        expect.objectContaining({
          code: "VALIDATION_ERROR",
          message: PRODUCT_PASSWORD_RULE_DESCRIPTION,
        }),
      );
    }
  });
});
