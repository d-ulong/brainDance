import { NextResponse } from "next/server";

import { requireStudentSession } from "@/lib/auth-request";
import { toErrorResponse } from "@/lib/http-errors";
import { getTrainingSessionForStudent } from "@/modules/training/session.service";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { db, dbUser } = await requireStudentSession();
    const { sessionId } = await context.params;

    const session = await getTrainingSessionForStudent(db, dbUser.id, sessionId);
    return NextResponse.json(session);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
