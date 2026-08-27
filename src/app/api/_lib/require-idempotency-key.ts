import { NextResponse } from "next/server";

export type IdempotencyKeyResult =
  { ok: true; key: string } | { ok: false; response: NextResponse };

export function requireIdempotencyKey(request: Request): IdempotencyKeyResult {
  const raw = request.headers.get("Idempotency-Key");
  const key = raw?.trim();

  if (!key) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "Idempotency-Key header is required",
          code: "IDEMPOTENCY_KEY_REQUIRED",
        },
        { status: 400 },
      ),
    };
  }

  return { ok: true, key };
}
