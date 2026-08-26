import { createHash } from "node:crypto";

/**
 * Stable JSON serialization with recursively sorted object keys.
 */
export function normalizeIdempotencyPayload(payload: unknown): string {
  return stableStringify(payload);
}

export function hashIdempotencyPayload(payload: unknown): string {
  return createHash("sha256").update(normalizeIdempotencyPayload(payload)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}
