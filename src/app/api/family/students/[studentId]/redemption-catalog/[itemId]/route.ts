import { NextResponse } from "next/server";

import { m2UuidParamSchema } from "@/app/api/_lib/m2-schemas";
import { updateRedemptionCatalogBodySchema } from "@/app/api/_lib/m6-schemas";
import { requireIdempotencyKey } from "@/app/api/_lib/require-idempotency-key";
import { toRouteErrorResponse } from "@/app/api/_lib/to-route-error-response";
import { requireVerifiedParentSession } from "@/lib/auth-request";
import { updateCatalogItem } from "@/modules/redemption/catalog.service";

type RouteContext = {
  params: Promise<{ studentId: string; itemId: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const idempotency = requireIdempotencyKey(request);
  if (!idempotency.ok) {
    return idempotency.response;
  }

  try {
    const { db, dbUser } = await requireVerifiedParentSession();
    const params = await context.params;
    const studentId = m2UuidParamSchema.parse(params.studentId);
    const itemId = m2UuidParamSchema.parse(params.itemId);
    const body = updateRedemptionCatalogBodySchema.parse(await request.json());

    const result = await updateCatalogItem(db, {
      parentId: dbUser.id,
      studentId,
      itemId,
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
