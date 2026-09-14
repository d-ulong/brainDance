import { NextResponse } from "next/server";
import { z } from "zod";

import { requireIdempotencyKey } from "@/app/api/_lib/require-idempotency-key";
import { toRouteErrorResponse } from "@/app/api/_lib/to-route-error-response";
import { requireTraineeSessionForWrites } from "@/lib/auth-request";
import { updateGoal } from "@/modules/goals/goal.service";

export async function PATCH(request: Request, context: { params: Promise<{ assignmentId: string }> }) {
  const key = requireIdempotencyKey(request);
  if (!key.ok) return key.response;
  try {
    const { db, dbUser } = await requireTraineeSessionForWrites();
    const { assignmentId } = await context.params;
    const input = z.object({
      revision: z.number().int().positive(),
      content: z.string().min(1).max(500),
      dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      expectedPoints: z.number().int().min(0).max(1_000_000).nullable().optional(),
      expectedGift: z.string().max(200).nullable().optional(),
      notes: z.string().max(1_000).nullable().optional(),
    }).parse(await request.json());
    return NextResponse.json(await updateGoal(db, { actorId: dbUser.id, assignmentId, ...input, idempotencyKey: key.key }));
  } catch (error) {
    const { status, body } = toRouteErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
