/**
 * Fail-closed guard for capacity/recovery scripts.
 * Requires explicit synthetic opt-in and a database URL that cannot be mistaken for production.
 */

const PRODUCTION_HOST_PATTERNS = [
  /\.amazonaws\.com/i,
  /\.rds\./i,
  /\.azure\./i,
  /\.cloud\.google\.com/i,
  /prod/i,
  /production/i,
];

const SYNTHETIC_DB_NAME_PATTERNS = [/_synthetic$/i, /^bd_synth_/i, /^braindance_synth/i, /_e2e_/i];

export type SyntheticEnvGuardResult =
  { ok: true; databaseUrl: string; databaseName: string } | { ok: false; reason: string };

export function assertSyntheticEnvironment(): SyntheticEnvGuardResult {
  if (process.env.BRAIN_DANCE_SYNTHETIC !== "1") {
    return {
      ok: false,
      reason:
        "Refusing to run: set BRAIN_DANCE_SYNTHETIC=1 to confirm this is an isolated synthetic environment.",
    };
  }

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    return { ok: false, reason: "Refusing to run: DATABASE_URL is not set." };
  }

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    return { ok: false, reason: "Refusing to run: DATABASE_URL is not a valid URL." };
  }

  const databaseName = parsed.pathname.replace(/^\//, "");
  if (!databaseName) {
    return { ok: false, reason: "Refusing to run: DATABASE_URL has no database name." };
  }

  for (const pattern of PRODUCTION_HOST_PATTERNS) {
    if (pattern.test(parsed.hostname) || pattern.test(databaseName)) {
      return {
        ok: false,
        reason: `Refusing to run: DATABASE_URL matches production-like pattern (${pattern}).`,
      };
    }
  }

  const isLocalhost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  const hasSyntheticDbName = SYNTHETIC_DB_NAME_PATTERNS.some((pattern) =>
    pattern.test(databaseName),
  );

  if (!isLocalhost && !hasSyntheticDbName) {
    return {
      ok: false,
      reason:
        "Refusing to run: non-localhost DATABASE_URL must use a synthetic database name suffix (_synthetic, bd_synth_*, braindance_synth*, *_e2e_*).",
    };
  }

  return { ok: true, databaseUrl, databaseName };
}

export function requireSyntheticEnvironment(): { databaseUrl: string; databaseName: string } {
  const result = assertSyntheticEnvironment();
  if (!result.ok) {
    console.error(result.reason);
    process.exit(1);
  }
  return { databaseUrl: result.databaseUrl, databaseName: result.databaseName };
}
