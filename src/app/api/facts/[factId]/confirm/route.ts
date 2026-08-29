import { NextResponse } from "next/server";

import { m2UuidParamSchema } from "@/app/api/_lib/m2-schemas";
import { requireIdempotencyKey } from "@/app/api/_lib/require-idempotency-key";
import { toRouteErrorResponse } from "@/app/api/_lib/to-route-error-response";
import { requireVerifiedParentSession } from "@/lib/auth-request";
import { confirmFact } from "@/modules/facts/confirm-fact.service";

type RouteContext = {
  params: Promise<{ factId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const idempotency = requireIdempotencyKey(request);
  if (!idempotency.ok) {
    return idempotency.response;
  }

  try {
    const { db, dbUser } = await requireVerifiedParentSession();
    const { factId: rawFactId } = await context.params;
    const factId = m2UuidParamSchema.parse(rawFactId);

    const result = await confirmFact(db, {
      parentId: dbUser.id,
      factId,
      idempotencyKey: idempotency.key,
      requestId: request.headers.get("x-request-id") ?? undefined,
    });

    return NextResponse.json(result);
  } catch (error) {
    const { status, body } = toRouteErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
