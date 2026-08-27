import { NextResponse } from "next/server";

export type IdempotencyKeyResult =
  { ok: true; key: string } | { ok: false; response: NextResponse };

export function requireIdempotencyKey(request: Request): IdempotencyKeyResult {
  const raw = request.headers.get("Idempotency-Key");

  if (!raw || raw.trim() === "") {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: {
            code: "IDEMPOTENCY_KEY_REQUIRED",
            message: "Idempotency-Key header is required",
          },
        },
        { status: 400 },
      ),
    };
  }

  return { ok: true, key: raw };
}
