import { NextResponse } from "next/server";

import { m2UuidParamSchema } from "@/app/api/_lib/m2-schemas";
import { requireIdempotencyKey } from "@/app/api/_lib/require-idempotency-key";
import { toRouteErrorResponse } from "@/app/api/_lib/to-route-error-response";
import { requireAuthenticatedSession } from "@/lib/auth-request";
import {
  cancelDeletionRequest,
  getDeletionRequest,
} from "@/modules/data-lifecycle/deletion-request.service";

type RouteContext = {
  params: Promise<{ requestId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { db, dbUser } = await requireAuthenticatedSession();
    const { requestId: rawRequestId } = await context.params;
    const requestId = m2UuidParamSchema.parse(rawRequestId);

    const request = await getDeletionRequest(db, requestId);
    if (!request) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Deletion request not found" } },
        { status: 404 },
      );
    }

    if (
      request.requestedBy !== dbUser.id &&
      request.studentId !== dbUser.id &&
      dbUser.role !== "admin"
    ) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Deletion request not found" } },
        { status: 404 },
      );
    }

    return NextResponse.json({ request });
  } catch (error) {
    const { status, body } = toRouteErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const idempotency = requireIdempotencyKey(request);
  if (!idempotency.ok) {
    return idempotency.response;
  }

  try {
    const { db, dbUser } = await requireAuthenticatedSession();
    const { requestId: rawRequestId } = await context.params;
    const requestId = m2UuidParamSchema.parse(rawRequestId);

    const result = await cancelDeletionRequest(db, {
      requestId,
      actorId: dbUser.id,
      idempotencyKey: idempotency.key,
      requestIdHeader: request.headers.get("x-request-id") ?? undefined,
    });

    return NextResponse.json(result);
  } catch (error) {
    const { status, body } = toRouteErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
