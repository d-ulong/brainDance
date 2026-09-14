import { NextResponse } from "next/server";
import { z } from "zod";

import { requireIdempotencyKey } from "@/app/api/_lib/require-idempotency-key";
import { toRouteErrorResponse } from "@/app/api/_lib/to-route-error-response";
import { requireVerifiedParentSession } from "@/lib/auth-request";
import { approveGoal } from "@/modules/goals/goal.service";

export async function POST(request: Request, context: { params: Promise<{ assignmentId: string }> }) {
  const key = requireIdempotencyKey(request);
  if (!key.ok) return key.response;
  try {
    const { db, dbUser } = await requireVerifiedParentSession();
    const { assignmentId } = z.object({ assignmentId: z.string().uuid() }).parse(await context.params);
    return NextResponse.json(await approveGoal(db, { actorId: dbUser.id, assignmentId, idempotencyKey: key.key }));
  } catch (error) {
    const { status, body } = toRouteErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
