import { NextResponse } from "next/server";

import { editFormalPlanBodySchema, m2UuidParamSchema } from "@/app/api/_lib/m2-schemas";
import { requireIdempotencyKey } from "@/app/api/_lib/require-idempotency-key";
import { toRouteErrorResponse } from "@/app/api/_lib/to-route-error-response";
import { requireVerifiedParentSession } from "@/lib/auth-request";
import { editFormalPlan } from "@/modules/schedule/plan.service";

type RouteContext = {
  params: Promise<{ planId: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const idempotency = requireIdempotencyKey(request);
  if (!idempotency.ok) {
    return idempotency.response;
  }

  try {
    const { db, dbUser } = await requireVerifiedParentSession();
    const { planId: rawPlanId } = await context.params;
    const planId = m2UuidParamSchema.parse(rawPlanId);
    const body = editFormalPlanBodySchema.parse(await request.json());

    const result = await editFormalPlan(db, {
      ownerId: dbUser.id,
      planId,
      idempotencyKey: idempotency.key,
      body: {
        title: body.title,
        description: body.description,
        localTime: body.localTime,
        endDate: body.endDate,
      },
      requestId: request.headers.get("x-request-id") ?? undefined,
    });

    return NextResponse.json(result);
  } catch (error) {
    const { status, body } = toRouteErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
