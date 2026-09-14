import { NextResponse } from "next/server";
import { z } from "zod";

import { requireIdempotencyKey } from "@/app/api/_lib/require-idempotency-key";
import { toRouteErrorResponse } from "@/app/api/_lib/to-route-error-response";
import { requireTraineeSession, requireVerifiedParentSession } from "@/lib/auth-request";
import { createManualPenalty, listManualPenalties } from "@/modules/settlement/manual-points.service";

export async function GET(_request: Request, context: { params: Promise<{ studentId: string }> }) {
  try {
    const { db, dbUser } = await requireTraineeSession();
    const { studentId } = z.object({ studentId: z.string().uuid() }).parse(await context.params);
    return NextResponse.json({ adjustments: await listManualPenalties(db, { actorId: dbUser.id, actorRole: dbUser.role, studentId }) });
  } catch (error) {
    const { status, body } = toRouteErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function POST(request: Request, context: { params: Promise<{ studentId: string }> }) {
  const key = requireIdempotencyKey(request);
  if (!key.ok) return key.response;
  try {
    const { db, dbUser } = await requireVerifiedParentSession();
    const { studentId } = z.object({ studentId: z.string().uuid() }).parse(await context.params);
    const body = z.object({ points: z.number().int().positive().max(1_000_000), reason: z.string().min(2).max(200) }).parse(await request.json());
    return NextResponse.json(await createManualPenalty(db, { actorParentId: dbUser.id, studentId, ...body, idempotencyKey: key.key }));
  } catch (error) {
    const { status, body } = toRouteErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
