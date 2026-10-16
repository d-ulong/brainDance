import { createHmac, timingSafeEqual } from "node:crypto";

import { IdentityError } from "@/modules/identity/errors";

function decodeBase32(secret: string): Buffer {
  const normalized = secret.toUpperCase().replace(/=+$/, "");
  if (!/^[A-Z2-7]{26,128}$/.test(normalized)) throw new Error("Invalid TOTP secret");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const character of normalized) {
    value = (value << 5) | "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 255);
    }
  }
  return Buffer.from(bytes);
}

export function configuredAdminTotpSecret(adminId: string): string {
  try {
    const secrets: unknown = JSON.parse(process.env.ADMIN_TOTP_SECRETS ?? "{}");
    const secret =
      secrets && typeof secrets === "object"
        ? (secrets as Record<string, unknown>)[adminId]
        : undefined;
    if (typeof secret !== "string") throw new Error("Missing secret");
    decodeBase32(secret);
    return secret;
  } catch {
    throw new IdentityError("MFA_NOT_CONFIGURED", "管理员第二因素尚未配置，请联系部署负责人");
  }
}

export function totpForStep(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", decodeBase32(secret)).update(counter).digest();
  const offset = digest[digest.length - 1]! & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

/** RFC 6238, 30 second steps, one step clock tolerance; caller persists matched step. */
export function verifyAdminTotp(
  secret: string,
  code: string,
  lastStep: number | null,
  now = new Date(),
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const step = Math.floor(now.getTime() / 30_000);
  for (const candidate of [step, step - 1, step + 1]) {
    if (lastStep !== null && candidate <= lastStep) continue;
    if (timingSafeEqual(Buffer.from(totpForStep(secret, candidate)), Buffer.from(code)))
      return candidate;
  }
  return null;
}
