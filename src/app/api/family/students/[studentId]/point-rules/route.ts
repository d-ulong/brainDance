import { NextResponse } from "next/server";

import { requireIdempotencyKey } from "@/app/api/_lib/require-idempotency-key";
import { enablePointRuleBodySchema } from "@/app/api/_lib/m2-schemas";
import { toRouteErrorResponse } from "@/app/api/_lib/to-route-error-response";
import { requireVerifiedParentSession } from "@/lib/auth-request";
import { enablePointRule } from "@/modules/settlement/point-rule.service";

type RouteContext = {
  params: Promise<{ studentId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const idempotency = requireIdempotencyKey(request);
  if (!idempotency.ok) {
    return idempotency.response;
  }

  try {
    const { db, dbUser } = await requireVerifiedParentSession();
    const { studentId } = await context.params;
    const body = enablePointRuleBodySchema.parse(await request.json());

    const result = await enablePointRule(db, {
      parentId: dbUser.id,
      studentId,
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
