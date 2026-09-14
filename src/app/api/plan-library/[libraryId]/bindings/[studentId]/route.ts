import { NextResponse } from "next/server";
import { z } from "zod";

import { requireIdempotencyKey } from "@/app/api/_lib/require-idempotency-key";
import { toRouteErrorResponse } from "@/app/api/_lib/to-route-error-response";
import { requireVerifiedParentSession } from "@/lib/auth-request";
import { removePlanLibraryBinding } from "@/modules/schedule/plan-library.service";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ libraryId: string; studentId: string }> },
) {
  const key = requireIdempotencyKey(request);
  if (!key.ok) return key.response;
  try {
    const { db, dbUser } = await requireVerifiedParentSession();
    const { libraryId, studentId } = z
      .object({ libraryId: z.string().uuid(), studentId: z.string().uuid() })
      .parse(await context.params);
    return NextResponse.json(
      await removePlanLibraryBinding(db, {
        ownerId: dbUser.id,
        libraryId,
        studentId,
        idempotencyKey: key.key,
      }),
    );
  } catch (error) {
    const { status, body } = toRouteErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
