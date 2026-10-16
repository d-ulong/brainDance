import { afterEach, describe, expect, it, vi } from "vitest";

import { configuredAdminTotpSecret, totpForStep, verifyAdminTotp } from "@/modules/identity/totp";
import { trustedClientIp } from "@/modules/identity/trusted-client-ip";
import {
  deliverVerificationCode,
  mayExposeDevOtpPlaintext,
} from "@/modules/identity/verification-delivery";
import { resolveMediaScanner } from "@/modules/family-content/media-scanner";
import { E2E_ADMIN_ID, isolatedE2eTotpConfig } from "../../helpers/e2e-auth-config";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("identity production controls", () => {
  const rfcSecret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

  it("matches RFC 6238 SHA1 vectors and rejects a replayed or malformed code", () => {
    const now = new Date(59_000);
    expect(totpForStep(rfcSecret, 1)).toBe("287082");
    expect(verifyAdminTotp(rfcSecret, "287082", null, now)).toBe(1);
    expect(verifyAdminTotp(rfcSecret, "287082", 1, now)).toBeNull();
    expect(verifyAdminTotp(rfcSecret, "12345", null, now)).toBeNull();
    expect(verifyAdminTotp(rfcSecret, totpForStep(rfcSecret, 10), null, now)).toBeNull();
  });

  it("fails closed without an operator-provisioned per-admin secret", () => {
    vi.stubEnv("ADMIN_TOTP_SECRETS", "{}");
    expect(() => configuredAdminTotpSecret("admin")).toThrow(
      expect.objectContaining({ code: "MFA_NOT_CONFIGURED" }),
    );
    vi.stubEnv("ADMIN_TOTP_SECRETS", JSON.stringify({ admin: rfcSecret }));
    expect(configuredAdminTotpSecret("admin")).toBe(rfcSecret);
  });

  it("trusts only an explicitly enabled single proxy address", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.2" });
    expect(trustedClientIp(headers, {})).toBeUndefined();
    expect(trustedClientIp(headers, { TRUST_PROXY_IP: "true" })).toBe("203.0.113.2");
    headers.set("x-forwarded-for", "203.0.113.2, 127.0.0.1");
    expect(trustedClientIp(headers, { TRUST_PROXY_IP: "true" })).toBeUndefined();
  });

  it("never exposes a production OTP even when the legacy flag is set", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("EXPOSE_DEV_OTP", "true");
    vi.stubEnv("VERIFICATION_DELIVERY_URL", "");
    expect(mayExposeDevOtpPlaintext()).toBe(false);
    await expect(
      deliverVerificationCode({
        verificationId: "id",
        contactType: "email",
        contactValue: "test@example.invalid",
        code: "123456",
        expiresAt: new Date(),
      }),
    ).rejects.toMatchObject({ code: "DELIVERY_UNAVAILABLE" });
  });

  it("reports relay failure without returning provider content", async () => {
    vi.stubEnv("VERIFICATION_DELIVERY_URL", "https://relay.example.invalid/code");
    vi.stubEnv("VERIFICATION_DELIVERY_TOKEN", "test-only-token");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    await expect(
      deliverVerificationCode({
        verificationId: "id",
        contactType: "email",
        contactValue: "test@example.invalid",
        code: "123456",
        expiresAt: new Date(),
      }),
    ).rejects.toMatchObject({ code: "DELIVERY_UNAVAILABLE" });
  });

  it("rejects production test-clean even with the legacy bypass flag", async () => {
    const scanner = resolveMediaScanner({
      NODE_ENV: "production",
      BRAIN_DANCE_MEDIA_SCANNER: "test-clean",
      BRAIN_DANCE_ALLOW_TEST_MEDIA_SCANNER: "true",
    });
    await expect(scanner.scan(Buffer.from("content"), "image/png")).resolves.toEqual({
      outcome: "error",
      category: "scanner_not_configured",
    });
  });

  it("confines public E2E administrator credentials to an explicitly isolated database", () => {
    vi.stubEnv("DATABASE_URL", "postgres://unused@localhost/braindance_pilot");
    expect(() => isolatedE2eTotpConfig()).toThrow("isolated/test/e2e");
    vi.stubEnv("DATABASE_URL", "postgres://unused@localhost/braindance_test_review");
    expect(Object.keys(JSON.parse(isolatedE2eTotpConfig()))).toEqual([E2E_ADMIN_ID]);
  });
});
