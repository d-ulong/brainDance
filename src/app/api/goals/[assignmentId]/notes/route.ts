import { NextResponse } from "next/server";
import { z } from "zod";

import { requireIdempotencyKey } from "@/app/api/_lib/require-idempotency-key";
import { toRouteErrorResponse } from "@/app/api/_lib/to-route-error-response";
import { requireTraineeSessionForWrites } from "@/lib/auth-request";
import { addGoalNote } from "@/modules/goals/goal.service";

export async function POST(request: Request, context: { params: Promise<{ assignmentId: string }> }) {
  const key = requireIdempotencyKey(request);
  if (!key.ok) return key.response;
  try {
    const { db, dbUser } = await requireTraineeSessionForWrites();
    const { assignmentId } = await context.params;
    const { body } = z.object({ body: z.string().min(1).max(1_000) }).parse(await request.json());
    return NextResponse.json(await addGoalNote(db, { actorId: dbUser.id, assignmentId, body, idempotencyKey: key.key }));
  } catch (error) {
    const { status, body } = toRouteErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
