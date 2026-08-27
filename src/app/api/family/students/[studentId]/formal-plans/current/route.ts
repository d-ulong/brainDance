import { NextResponse } from "next/server";

import { queryCurrentFormalPlan } from "@/app/api/_lib/m2-read-queries";
import { requireStudentReadAccess } from "@/app/api/_lib/student-read-access";
import { toRouteErrorResponse } from "@/app/api/_lib/to-route-error-response";
import { requireAuthenticatedSession } from "@/lib/auth-request";

type RouteContext = {
  params: Promise<{ studentId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { db, dbUser } = await requireAuthenticatedSession();
    const { studentId } = await context.params;

    await requireStudentReadAccess(db, dbUser, studentId);

    const plan = await queryCurrentFormalPlan(db, studentId);
    return NextResponse.json({ plan });
  } catch (error) {
    const { status, body } = toRouteErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
