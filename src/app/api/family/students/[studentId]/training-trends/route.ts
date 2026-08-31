import { NextResponse } from "next/server";
import { z } from "zod";

import { m2UuidParamSchema } from "@/app/api/_lib/m2-schemas";
import { requireStudentReadAccess } from "@/app/api/_lib/student-read-access";
import { toRouteErrorResponse } from "@/app/api/_lib/to-route-error-response";
import { requireAuthenticatedSession } from "@/lib/auth-request";
import {
  DIGIT_SPAN_TRAINING_KEY,
  REACTION_TRAINING_KEY,
  STROOP_TRAINING_KEY,
} from "@/modules/training/constants";
import { queryTrainingTrends } from "@/modules/training/trends.service";

const trainingTrendQuerySchema = z.object({
  trainingKey: z.enum([REACTION_TRAINING_KEY, STROOP_TRAINING_KEY, DIGIT_SPAN_TRAINING_KEY]),
  window: z.enum(["7d", "30d", "all"]).default("7d"),
});

type RouteContext = {
  params: Promise<{ studentId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { db, dbUser } = await requireAuthenticatedSession();
    const { studentId: rawStudentId } = await context.params;
    const studentId = m2UuidParamSchema.parse(rawStudentId);

    await requireStudentReadAccess(db, dbUser, studentId);

    const url = new URL(request.url);
    const query = trainingTrendQuerySchema.parse({
      trainingKey: url.searchParams.get("trainingKey"),
      window: url.searchParams.get("window") ?? "7d",
    });

    const trends = await queryTrainingTrends(db, {
      studentId,
      trainingKey: query.trainingKey,
      window: query.window,
    });

    return NextResponse.json(trends);
  } catch (error) {
    const { status, body } = toRouteErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
