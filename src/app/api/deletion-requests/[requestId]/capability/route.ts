import { NextResponse } from "next/server";
import { z } from "zod";

import { m2UuidParamSchema } from "@/app/api/_lib/m2-schemas";
import { requireIdempotencyKey } from "@/app/api/_lib/require-idempotency-key";
import { toRouteErrorResponse } from "@/app/api/_lib/to-route-error-response";
import { getDb } from "@/db";
import {
  DELETION_CAPABILITY_COOKIE,
  DELETION_CAPABILITY_TTL_MS,
  issueDeletionCapability,
} from "@/modules/data-lifecycle/deletion-capability.service";

const bodySchema = z.object({
  identifier: z.string().min(3).max(128),
  password: z.string().min(1).max(128),
});

type RouteContext = {
  params: Promise<{ requestId: string }>;
};

/**
 * Re-authenticates a frozen student and issues a narrow deletion-management
 * capability (F02). The capability is delivered as an HttpOnly cookie scoped to
 * /api/deletion-requests and authorizes ONLY status/cancel/confirm for the
 * request in the path — never a generic session that can call other routes.
 */
export async function POST(request: Request, context: RouteContext) {
  const idempotency = requireIdempotencyKey(request);
  if (!idempotency.ok) {
    return idempotency.response;
  }

  try {
    const db = getDb();
    const body = bodySchema.parse(await request.json());
    const { requestId: rawRequestId } = await context.params;
    const requestId = m2UuidParamSchema.parse(rawRequestId);

    const result = await issueDeletionCapability(db, {
      identifier: body.identifier,
      password: body.password,
      requestId,
      requestIdHeader: request.headers.get("x-request-id") ?? undefined,
    });

    const response = NextResponse.json({
      expiresAt: result.expiresAt,
    });

    response.cookies.set(DELETION_CAPABILITY_COOKIE, result.capabilityToken, {
      path: "/api/deletion-requests",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: Math.floor(DELETION_CAPABILITY_TTL_MS / 1000),
    });

    return response;
  } catch (error) {
    const { status, body } = toRouteErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
