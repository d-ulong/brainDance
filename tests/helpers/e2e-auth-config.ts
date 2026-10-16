// Public, deterministic credentials for isolated browser tests only.
export const E2E_ADMIN_ID = "09999999-0000-4000-8000-000000000001";
export const E2E_RESET_ADMIN_ID = "09999999-0000-4000-8000-000000000002";
export const E2E_RESET_ACTOR_ID = "09999999-0000-4000-8000-000000000003";
export const E2E_ADMIN_EMAIL = "e2e-admin@test.local";
export const E2E_ADMIN_TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

export function isolatedE2eTotpConfig(): string {
  const databaseName = new URL(process.env.DATABASE_URL ?? "invalid:").pathname
    .replace(/^\//, "")
    .toLowerCase();
  if (!/(^|_)(test|isolated|e2e)(_|$)/.test(databaseName)) {
    throw new Error("E2E credentials require an explicitly named isolated/test/e2e DATABASE_URL");
  }
  return JSON.stringify({
    [E2E_ADMIN_ID]: E2E_ADMIN_TOTP_SECRET,
    [E2E_RESET_ADMIN_ID]: E2E_ADMIN_TOTP_SECRET,
    [E2E_RESET_ACTOR_ID]: E2E_ADMIN_TOTP_SECRET,
  });
}
