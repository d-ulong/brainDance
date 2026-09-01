import { NextResponse } from "next/server";

import { createDeletionRequestBodySchema } from "@/app/api/_lib/m6-lifecycle-schemas";
import { requireIdempotencyKey } from "@/app/api/_lib/require-idempotency-key";
import { toRouteErrorResponse } from "@/app/api/_lib/to-route-error-response";
import { requireAuthenticatedSession } from "@/lib/auth-request";
import { createDeletionRequest } from "@/modules/data-lifecycle/deletion-request.service";
import { deletionRouteArtifactStore } from "@/modules/data-lifecycle/route-artifact-stores";

export async function POST(request: Request) {
  const idempotency = requireIdempotencyKey(request);
  if (!idempotency.ok) {
    return idempotency.response;
  }

  try {
    const { db, dbUser } = await requireAuthenticatedSession();
    const body = createDeletionRequestBodySchema.parse(await request.json());

    const requesterRole =
      dbUser.role === "admin"
        ? ("admin" as const)
        : dbUser.role === "student"
          ? ("student" as const)
          : ("parent" as const);

    if (dbUser.role !== "student" && dbUser.role !== "admin") {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: "Deletion request not allowed for this role" } },
        { status: 403 },
      );
    }

    const result = await createDeletionRequest(db, {
      targetType: body.targetType,
      targetId: body.targetId,
      requestedBy: dbUser.id,
      requesterRole,
      idempotencyKey: idempotency.key,
      requestId: request.headers.get("x-request-id") ?? undefined,
      artifactStore: deletionRouteArtifactStore,
    });

    return NextResponse.json(result);
  } catch (error) {
    const { status, body } = toRouteErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
