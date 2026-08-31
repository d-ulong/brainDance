import { NextResponse } from "next/server";

import { m2UuidParamSchema } from "@/app/api/_lib/m2-schemas";
import { requireIdempotencyKey } from "@/app/api/_lib/require-idempotency-key";
import { toRouteErrorResponse } from "@/app/api/_lib/to-route-error-response";
import { requireVerifiedParentSession } from "@/lib/auth-request";
import { approveRedemptionRequest } from "@/modules/redemption/redemption.service";

type RouteContext = {
  params: Promise<{ studentId: string; redemptionId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const idempotency = requireIdempotencyKey(request);
  if (!idempotency.ok) {
    return idempotency.response;
  }

  try {
    const { db, dbUser } = await requireVerifiedParentSession();
    const params = await context.params;
    const studentId = m2UuidParamSchema.parse(params.studentId);
    const redemptionId = m2UuidParamSchema.parse(params.redemptionId);

    const result = await approveRedemptionRequest(db, {
      parentId: dbUser.id,
      studentId,
      redemptionId,
      idempotencyKey: idempotency.key,
      requestId: request.headers.get("x-request-id") ?? undefined,
    });

    return NextResponse.json(result);
  } catch (error) {
    const { status, body } = toRouteErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
