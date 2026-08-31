import { NextResponse } from "next/server";

import { m2UuidParamSchema } from "@/app/api/_lib/m2-schemas";
import { adminForceDeletionBodySchema } from "@/app/api/_lib/m6-lifecycle-schemas";
import { requireIdempotencyKey } from "@/app/api/_lib/require-idempotency-key";
import { toRouteErrorResponse } from "@/app/api/_lib/to-route-error-response";
import { requireAdminSession } from "@/lib/auth-request";
import { adminForceDeletionExecution } from "@/modules/data-lifecycle/deletion-request.service";

type RouteContext = {
  params: Promise<{ requestId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const idempotency = requireIdempotencyKey(request);
  if (!idempotency.ok) {
    return idempotency.response;
  }

  try {
    const { db, dbUser } = await requireAdminSession();
    const { requestId: rawRequestId } = await context.params;
    const requestId = m2UuidParamSchema.parse(rawRequestId);
    const body = adminForceDeletionBodySchema.parse(await request.json());

    const result = await adminForceDeletionExecution(db, {
      requestId,
      adminId: dbUser.id,
      reason: body.reason,
      idempotencyKey: idempotency.key,
      requestIdHeader: request.headers.get("x-request-id") ?? undefined,
    });

    return NextResponse.json(result);
  } catch (error) {
    const { status, body } = toRouteErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
