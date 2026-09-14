import { NextResponse } from "next/server";
import { z } from "zod";

import { requireIdempotencyKey } from "@/app/api/_lib/require-idempotency-key";
import { toRouteErrorResponse } from "@/app/api/_lib/to-route-error-response";
import { requireVerifiedParentSession } from "@/lib/auth-request";
import { reverseManualPenalty } from "@/modules/settlement/manual-points.service";

export async function POST(request: Request, context: { params: Promise<{ studentId: string; adjustmentId: string }> }) {
  const key = requireIdempotencyKey(request);
  if (!key.ok) return key.response;
  try {
    const { db, dbUser } = await requireVerifiedParentSession();
    const { studentId, adjustmentId } = z.object({ studentId: z.string().uuid(), adjustmentId: z.string().uuid() }).parse(await context.params);
    const body = await request.json() as { reason?: unknown };
    const reason = typeof body.reason === "string" ? body.reason : "";
    return NextResponse.json(await reverseManualPenalty(db, { actorParentId: dbUser.id, studentId, adjustmentId, reason, idempotencyKey: key.key }));
  } catch (error) {
    const { status, body } = toRouteErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
