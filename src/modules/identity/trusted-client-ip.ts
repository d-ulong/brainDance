import { isIP } from "node:net";

/** Only enable behind a proxy which replaces this header and blocks direct origin access. */
export function trustedClientIp(
  headers: Headers,
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  if (env.TRUST_PROXY_IP !== "true") return undefined;
  const address = headers.get("x-forwarded-for")?.trim();
  return address && isIP(address) ? address : undefined;
}
