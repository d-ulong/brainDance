import { NextResponse } from "next/server";
import { z } from "zod";

import { requireIdempotencyKey } from "@/app/api/_lib/require-idempotency-key";
import { toRouteErrorResponse } from "@/app/api/_lib/to-route-error-response";
import { requireVerifiedParentSession } from "@/lib/auth-request";
import { recordGoalGiftRedemption } from "@/modules/goals/goal.service";

export async function POST(request: Request, context: { params: Promise<{ assignmentId: string }> }) {
  const key = requireIdempotencyKey(request);
  if (!key.ok) return key.response;
  try {
    const { db, dbUser } = await requireVerifiedParentSession();
    const { assignmentId } = z.object({ assignmentId: z.string().uuid() }).parse(await context.params);
    const input = z
      .object({
        redeemedAt: z.string().min(1),
      })
      .parse(await request.json());
    return NextResponse.json(
      await recordGoalGiftRedemption(db, {
        actorId: dbUser.id,
        assignmentId,
        redeemedAt: input.redeemedAt,
        idempotencyKey: key.key,
      }),
    );
  } catch (error) {
    const { status, body } = toRouteErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
