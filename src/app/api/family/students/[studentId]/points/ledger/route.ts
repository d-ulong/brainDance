import { NextResponse } from "next/server";

import { pointsLedgerQuerySchema } from "@/app/api/_lib/m2-schemas";
import { queryPointsLedger } from "@/app/api/_lib/m2-read-queries";
import { requireStudentReadAccess } from "@/app/api/_lib/student-read-access";
import { toRouteErrorResponse } from "@/app/api/_lib/to-route-error-response";
import { requireAuthenticatedSession } from "@/lib/auth-request";

type RouteContext = {
  params: Promise<{ studentId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { db, dbUser } = await requireAuthenticatedSession();
    const { studentId } = await context.params;
    const url = new URL(request.url);
    const query = pointsLedgerQuerySchema.parse({
      limit: url.searchParams.get("limit") ?? undefined,
    });

    await requireStudentReadAccess(db, dbUser, studentId);

    const entries = await queryPointsLedger(db, studentId, query.limit);
    return NextResponse.json({ entries });
  } catch (error) {
    const { status, body } = toRouteErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
