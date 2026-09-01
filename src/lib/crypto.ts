import { createHmac, randomBytes, randomInt } from "node:crypto";

import { hash, verify } from "@node-rs/argon2";

export function getSecretPepper(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters");
  }
  return secret;
}

export function generateInviteCodePlaintext(): string {
  return randomBytes(24).toString("base64url");
}

export function hashInviteCode(plaintext: string): string {
  return createHmac("sha256", getSecretPepper()).update(plaintext).digest("hex");
}

export function generateAssociationCodePlaintext(): string {
  return randomBytes(24).toString("base64url");
}

export function hashAssociationCode(plaintext: string): string {
  return createHmac("sha256", getSecretPepper()).update(`assoc:${plaintext}`).digest("hex");
}

export function generateDownloadTokenPlaintext(): string {
  return randomBytes(32).toString("base64url");
}

export function hashDownloadToken(plaintext: string): string {
  return createHmac("sha256", getSecretPepper()).update(`download:${plaintext}`).digest("hex");
}

export function generateDeletionCapabilityToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashDeletionCapabilityToken(plaintext: string): string {
  return createHmac("sha256", getSecretPepper())
    .update(`deletion-capability:${plaintext}`)
    .digest("hex");
}

export function generateOtpPlaintext(): string {
  return randomInt(100_000, 1_000_000).toString();
}

export function hashOtp(plaintext: string): string {
  return createHmac("sha256", getSecretPepper()).update(`otp:${plaintext}`).digest("hex");
}

export async function hashPassword(plaintext: string): Promise<string> {
  return hash(plaintext, {
    memoryCost: 19456,
    timeCost: 2,
    outputLen: 32,
    parallelism: 1,
  });
}

export async function verifyPassword(plaintext: string, passwordHash: string): Promise<boolean> {
  return verify(passwordHash, plaintext, {
    memoryCost: 19456,
    timeCost: 2,
    outputLen: 32,
    parallelism: 1,
  });
}

export function normalizeAccountKey(value: string): string {
  return value.trim().toLowerCase();
}

export function maskContact(value: string): string {
  if (value.includes("@")) {
    const [local, domain] = value.split("@");
    if (!local || !domain) return "***";
    return `${local.slice(0, 1)}***@${domain}`;
  }
  if (value.length <= 4) return "***";
  return `${value.slice(0, 3)}***${value.slice(-2)}`;
}
