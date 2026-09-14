import { NextResponse } from "next/server";
import { z } from "zod";

import { requireIdempotencyKey } from "@/app/api/_lib/require-idempotency-key";
import { toRouteErrorResponse } from "@/app/api/_lib/to-route-error-response";
import { requireTraineeSession, requireTraineeSessionForWrites } from "@/lib/auth-request";
import { createGoals, listGoals } from "@/modules/goals/goal.service";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export async function GET() {
  try {
    const { db, dbUser } = await requireTraineeSession();
    return NextResponse.json({ goals: await listGoals(db, dbUser.id) });
  } catch (error) {
    const { status, body } = toRouteErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function POST(request: Request) {
  const key = requireIdempotencyKey(request);
  if (!key.ok) return key.response;
  try {
    const { db, dbUser } = await requireTraineeSessionForWrites();
    const input = z.object({
      subjectIds: z.array(z.string().uuid()).max(50).optional(),
      content: z.string().min(1).max(500),
      dueDate: z.string().regex(datePattern),
      expectedPoints: z.number().int().min(0).max(1_000_000).nullable().optional(),
      expectedGift: z.string().max(200).nullable().optional(),
      notes: z.string().max(1_000).nullable().optional(),
    }).parse(await request.json());
    return NextResponse.json(await createGoals(db, { actorId: dbUser.id, ...input, idempotencyKey: key.key }));
  } catch (error) {
    const { status, body } = toRouteErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
