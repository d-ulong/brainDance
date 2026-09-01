import { NextResponse } from "next/server";

import { readDeletionCapabilityCookie } from "@/app/api/_lib/deletion-capability-cookie";
import { m2UuidParamSchema } from "@/app/api/_lib/m2-schemas";
import { requireIdempotencyKey } from "@/app/api/_lib/require-idempotency-key";
import { toRouteErrorResponse } from "@/app/api/_lib/to-route-error-response";
import { getDb } from "@/db";
import { requireAuthenticatedSession } from "@/lib/auth-request";
import {
  cancelDeletionRequest,
  getDeletionRequestForActor,
} from "@/modules/data-lifecycle/deletion-request.service";
import { findValidDeletionCapability } from "@/modules/data-lifecycle/deletion-capability.service";

type RouteContext = {
  params: Promise<{ requestId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { requestId: rawRequestId } = await context.params;
    const requestId = m2UuidParamSchema.parse(rawRequestId);

    const capabilityToken = await readDeletionCapabilityCookie();
    if (capabilityToken) {
      const capability = await findValidDeletionCapability(getDb(), requestId, capabilityToken);
      if (capability) {
        const request = await getDeletionRequestForActor(getDb(), requestId, {
          actorId: capability.studentId,
          actorRole: "student",
        });
        return NextResponse.json({ request });
      }
    }

    const { db, dbUser } = await requireAuthenticatedSession();

    const request = await getDeletionRequestForActor(db, requestId, {
      actorId: dbUser.id,
      actorRole: dbUser.role as "student" | "parent" | "admin",
    });

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
    const { requestId: rawRequestId } = await context.params;
    const requestId = m2UuidParamSchema.parse(rawRequestId);

    const capabilityToken = await readDeletionCapabilityCookie();
    if (capabilityToken) {
      const result = await cancelDeletionRequest(getDb(), {
        requestId,
        capabilityToken,
        idempotencyKey: idempotency.key,
        requestIdHeader: request.headers.get("x-request-id") ?? undefined,
      });
      return NextResponse.json(result);
    }

    const { db, dbUser } = await requireAuthenticatedSession();

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
