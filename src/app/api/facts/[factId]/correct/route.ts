import { NextResponse } from "next/server";

import { correctFactBodySchema, m2UuidParamSchema } from "@/app/api/_lib/m2-schemas";
import { requireIdempotencyKey } from "@/app/api/_lib/require-idempotency-key";
import { toRouteErrorResponse } from "@/app/api/_lib/to-route-error-response";
import { requireAdminSession, requireVerifiedParentSession } from "@/lib/auth-request";
import { correctFact } from "@/modules/facts/correct-fact.service";

type RouteContext = {
  params: Promise<{ factId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const idempotency = requireIdempotencyKey(request);
  if (!idempotency.ok) {
    return idempotency.response;
  }

  try {
    const { factId: rawFactId } = await context.params;
    const factId = m2UuidParamSchema.parse(rawFactId);
    const rawBody = await request.json();
    const body = correctFactBodySchema.parse(rawBody);

    const adminReason =
      rawBody && typeof rawBody === "object" && "adminReason" in rawBody
        ? (rawBody as { adminReason?: string }).adminReason
        : undefined;

    if (adminReason === "security" || adminReason === "data_correction") {
      const { db, dbUser } = await requireAdminSession();
      const result = await correctFact(db, {
        actorId: dbUser.id,
        factId,
        idempotencyKey: idempotency.key,
        body,
        adminOverride: { reason: adminReason },
        requestId: request.headers.get("x-request-id") ?? undefined,
      });
      return NextResponse.json(result);
    }

    const { db, dbUser } = await requireVerifiedParentSession();
    const result = await correctFact(db, {
      actorId: dbUser.id,
      factId,
      idempotencyKey: idempotency.key,
      body,
      requestId: request.headers.get("x-request-id") ?? undefined,
    });

    return NextResponse.json(result);
  } catch (error) {
    const { status, body } = toRouteErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
