import { NextResponse } from "next/server";

import { m2UuidParamSchema, replayOutboxBodySchema } from "@/app/api/_lib/m2-schemas";
import { requireIdempotencyKey } from "@/app/api/_lib/require-idempotency-key";
import { toRouteErrorResponse } from "@/app/api/_lib/to-route-error-response";
import { requireAdminSession } from "@/lib/auth-request";
import { replayDeadOutboxEvent } from "@/modules/outbox/replay-outbox-event.service";

type RouteContext = {
  params: Promise<{ eventId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const idempotency = requireIdempotencyKey(request);
  if (!idempotency.ok) {
    return idempotency.response;
  }

  try {
    const { db, dbUser } = await requireAdminSession();
    const { eventId: rawEventId } = await context.params;
    const eventId = m2UuidParamSchema.parse(rawEventId);
    const body = replayOutboxBodySchema.parse(await request.json());

    const result = await replayDeadOutboxEvent(db, {
      eventId,
      actorId: dbUser.id,
      reason: body.reason,
      idempotencyKey: idempotency.key,
    });

    return NextResponse.json(result);
  } catch (error) {
    const { status, body } = toRouteErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
