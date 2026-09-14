import { NextResponse } from "next/server";
import { z } from "zod";

import { toRouteErrorResponse } from "@/app/api/_lib/to-route-error-response";
import { requireTraineeSession } from "@/lib/auth-request";
import { getPointsPeriodSummary } from "@/modules/settlement/manual-points.service";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export async function GET(request: Request, context: { params: Promise<{ studentId: string }> }) {
  try {
    const { db, dbUser } = await requireTraineeSession();
    const { studentId } = z.object({ studentId: z.string().uuid() }).parse(await context.params);
    const url = new URL(request.url);
    const { from, through } = z.object({ from: date, through: date }).parse({ from: url.searchParams.get("from"), through: url.searchParams.get("through") });
    return NextResponse.json(await getPointsPeriodSummary(db, { actorId: dbUser.id, actorRole: dbUser.role, studentId, from, through }));
  } catch (error) {
    const { status, body } = toRouteErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
