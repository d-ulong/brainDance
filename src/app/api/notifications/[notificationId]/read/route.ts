import { NextResponse } from "next/server";

import { m2UuidParamSchema } from "@/app/api/_lib/m2-schemas";
import { requireIdempotencyKey } from "@/app/api/_lib/require-idempotency-key";
import { toRouteErrorResponse } from "@/app/api/_lib/to-route-error-response";
import { requireAuthenticatedSession } from "@/lib/auth-request";
import { markNotificationRead } from "@/modules/notification/notification.service";
import { FamilyContentError } from "@/modules/family-content/errors";

type RouteContext = {
  params: Promise<{ notificationId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const idempotency = requireIdempotencyKey(request);
  if (!idempotency.ok) {
    return idempotency.response;
  }

  try {
    const { db, dbUser } = await requireAuthenticatedSession();
    const { notificationId: rawId } = await context.params;
    const notificationId = m2UuidParamSchema.parse(rawId);
    const item = await markNotificationRead(db, {
      userId: dbUser.id,
      notificationId,
    });
    if (!item) {
      throw new FamilyContentError("NOT_FOUND", "Notification not found");
    }
    return NextResponse.json(item);
  } catch (error) {
    const { status, body } = toRouteErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
