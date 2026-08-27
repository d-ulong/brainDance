import { NextResponse } from "next/server";

import { m2UuidParamSchema, skipScheduleBodySchema } from "@/app/api/_lib/m2-schemas";
import { requireIdempotencyKey } from "@/app/api/_lib/require-idempotency-key";
import { toRouteErrorResponse } from "@/app/api/_lib/to-route-error-response";
import { requireAuthenticatedSession } from "@/lib/auth-request";
import { skipScheduleItem } from "@/modules/schedule/skip-schedule.service";

type RouteContext = {
  params: Promise<{ itemId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const idempotency = requireIdempotencyKey(request);
  if (!idempotency.ok) {
    return idempotency.response;
  }

  try {
    const { db, dbUser } = await requireAuthenticatedSession();
    const { itemId: rawItemId } = await context.params;
    const itemId = m2UuidParamSchema.parse(rawItemId);

    let parsedBody: { reason?: string | null } = {};
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const json = await request.json();
      parsedBody = skipScheduleBodySchema.parse(json);
    }

    const result = await skipScheduleItem(db, {
      actorId: dbUser.id,
      scheduleItemId: itemId,
      idempotencyKey: idempotency.key,
      body: parsedBody,
      requestId: request.headers.get("x-request-id") ?? undefined,
    });

    return NextResponse.json(result);
  } catch (error) {
    const { status, body } = toRouteErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
