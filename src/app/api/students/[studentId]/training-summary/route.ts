import { NextResponse } from "next/server";

import { requireParentSession } from "@/lib/auth-request";
import { toErrorResponse } from "@/lib/http-errors";
import { REACTION_TRAINING_KEY } from "@/modules/training/constants";
import { getTrainingSummaryForParent } from "@/modules/training/session.service";

type RouteContext = {
  params: Promise<{ studentId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { db, dbUser } = await requireParentSession();
    const { studentId } = await context.params;
    const url = new URL(request.url);
    const trainingKey = url.searchParams.get("trainingKey") ?? REACTION_TRAINING_KEY;

    const summary = await getTrainingSummaryForParent(db, dbUser.id, studentId, trainingKey);
    return NextResponse.json(summary);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
