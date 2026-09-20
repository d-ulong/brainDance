import { NextResponse } from "next/server";

import { m2UuidParamSchema } from "@/app/api/_lib/m2-schemas";
import { requireStudentReadAccess } from "@/app/api/_lib/student-read-access";
import { toRouteErrorResponse } from "@/app/api/_lib/to-route-error-response";
import { requireAuthenticatedSession } from "@/lib/auth-request";
import { getTrainingSessionForStudent } from "@/modules/training/session.service";

type RouteContext = {
  params: Promise<{ studentId: string; sessionId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { db, dbUser } = await requireAuthenticatedSession();
    const params = await context.params;
    const studentId = m2UuidParamSchema.parse(params.studentId);
    const sessionId = m2UuidParamSchema.parse(params.sessionId);

    await requireStudentReadAccess(db, dbUser, studentId);

    const session = await getTrainingSessionForStudent(db, studentId, sessionId);
    return NextResponse.json(session);
  } catch (error) {
    const { status, body } = toRouteErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
