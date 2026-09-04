import { NextResponse } from "next/server";

import { requireTraineeSession } from "@/lib/auth-request";
import { toErrorResponse } from "@/lib/http-errors";
import { getTrainingSessionForSubject } from "@/modules/training/session.service";
import { resolveTrainingSubject } from "@/modules/training/training-subject";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { db, dbUser } = await requireTraineeSession();
    const { sessionId } = await context.params;
    const subject = await resolveTrainingSubject(db, dbUser.id);

    const session = await getTrainingSessionForSubject(db, subject, sessionId);
    return NextResponse.json(session);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
