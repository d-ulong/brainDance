import { NextResponse } from "next/server";

import { m2UuidParamSchema, submitErrorCountBodySchema } from "@/app/api/_lib/m2-schemas";
import { requireIdempotencyKey } from "@/app/api/_lib/require-idempotency-key";
import { toRouteErrorResponse } from "@/app/api/_lib/to-route-error-response";
import { requireStudentSessionForWrites } from "@/lib/auth-request";
import { submitErrorCount } from "@/modules/facts/submit-error-count.service";

type RouteContext = {
  params: Promise<{ itemId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const idempotency = requireIdempotencyKey(request);
  if (!idempotency.ok) {
    return idempotency.response;
  }

  try {
    const { db, dbUser } = await requireStudentSessionForWrites();
    const { itemId: rawItemId } = await context.params;
    const itemId = m2UuidParamSchema.parse(rawItemId);
    const body = submitErrorCountBodySchema.parse(await request.json());

    const result = await submitErrorCount(db, {
      actorId: dbUser.id,
      scheduleItemId: itemId,
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
