import { NextResponse } from "next/server";

import { m2UuidParamSchema } from "@/app/api/_lib/m2-schemas";
import { requireIdempotencyKey } from "@/app/api/_lib/require-idempotency-key";
import { toRouteErrorResponse } from "@/app/api/_lib/to-route-error-response";
import { requireStudentSessionForWrites } from "@/lib/auth-request";
import { confirmDeletionRequest } from "@/modules/data-lifecycle/deletion-request.service";

type RouteContext = {
  params: Promise<{ requestId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const idempotency = requireIdempotencyKey(request);
  if (!idempotency.ok) {
    return idempotency.response;
  }

  try {
    const { db, dbUser } = await requireStudentSessionForWrites();
    const { requestId: rawRequestId } = await context.params;
    const requestId = m2UuidParamSchema.parse(rawRequestId);

    const result = await confirmDeletionRequest(db, {
      requestId,
      studentId: dbUser.id,
      idempotencyKey: idempotency.key,
      requestIdHeader: request.headers.get("x-request-id") ?? undefined,
    });

    return NextResponse.json(result);
  } catch (error) {
    const { status, body } = toRouteErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
