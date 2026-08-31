import { NextResponse } from "next/server";

import { m2UuidParamSchema } from "@/app/api/_lib/m2-schemas";
import { requireIdempotencyKey } from "@/app/api/_lib/require-idempotency-key";
import { toRouteErrorResponse } from "@/app/api/_lib/to-route-error-response";
import { requireStudentSessionForWrites } from "@/lib/auth-request";
import { cancelRedemptionRequest } from "@/modules/redemption/redemption.service";

type RouteContext = {
  params: Promise<{ studentId: string; redemptionId: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const idempotency = requireIdempotencyKey(_request);
  if (!idempotency.ok) {
    return idempotency.response;
  }

  try {
    const { db, dbUser } = await requireStudentSessionForWrites();
    const params = await context.params;
    const studentId = m2UuidParamSchema.parse(params.studentId);
    const redemptionId = m2UuidParamSchema.parse(params.redemptionId);

    const result = await cancelRedemptionRequest(db, {
      studentId,
      actorId: dbUser.id,
      redemptionId,
      idempotencyKey: idempotency.key,
      requestId: _request.headers.get("x-request-id") ?? undefined,
    });

    return NextResponse.json(result);
  } catch (error) {
    const { status, body } = toRouteErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
