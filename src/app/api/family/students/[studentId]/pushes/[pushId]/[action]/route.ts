import { NextResponse } from "next/server";
import { z } from "zod";

import { m2UuidParamSchema } from "@/app/api/_lib/m2-schemas";
import { requireIdempotencyKey } from "@/app/api/_lib/require-idempotency-key";
import { toRouteErrorResponse } from "@/app/api/_lib/to-route-error-response";
import { requireVerifiedParentSession } from "@/lib/auth-request";
import { transitionFamilyPush } from "@/modules/family-content/push-lifecycle.service";

const actionSchema = z.enum(["publish", "cancel", "disable"]);

type RouteContext = {
  params: Promise<{ studentId: string; pushId: string; action: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const idempotency = requireIdempotencyKey(request);
  if (!idempotency.ok) {
    return idempotency.response;
  }

  try {
    const { db, dbUser } = await requireVerifiedParentSession();
    const { pushId: rawPushId, action: rawAction } = await context.params;
    const pushId = m2UuidParamSchema.parse(rawPushId);
    const action = actionSchema.parse(rawAction);

    const result = await transitionFamilyPush(db, {
      actorId: dbUser.id,
      pushId,
      action,
      idempotencyKey: idempotency.key,
      requestId: request.headers.get("x-request-id") ?? undefined,
    });

    return NextResponse.json({
      ...result.push,
      idempotentReplay: result.idempotentReplay,
    });
  } catch (error) {
    const { status, body } = toRouteErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
