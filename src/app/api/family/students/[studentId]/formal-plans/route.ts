import { NextResponse } from "next/server";

import { requireIdempotencyKey } from "@/app/api/_lib/require-idempotency-key";
import { createFormalPlanBodySchema } from "@/app/api/_lib/m2-schemas";
import { toRouteErrorResponse } from "@/app/api/_lib/to-route-error-response";
import { requireVerifiedParentSession } from "@/lib/auth-request";
import { createFormalPlan } from "@/modules/schedule/plan.service";

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
    const body = createFormalPlanBodySchema.parse(await request.json());

    const result = await createFormalPlan(db, {
      ownerId: dbUser.id,
      studentId,
      idempotencyKey: idempotency.key,
      body: {
        title: body.title,
        description: body.description ?? null,
        localTime: body.localTime,
        startDate: body.startDate,
        endDate: body.endDate ?? null,
      },
      requestId: request.headers.get("x-request-id") ?? undefined,
    });

    return NextResponse.json(result);
  } catch (error) {
    const { status, body } = toRouteErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
