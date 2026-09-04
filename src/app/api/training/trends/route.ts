import { NextResponse } from "next/server";
import { z } from "zod";

import { requireTraineeSession } from "@/lib/auth-request";
import { toErrorResponse } from "@/lib/http-errors";
import {
  DIGIT_SPAN_TRAINING_KEY,
  REACTION_TRAINING_KEY,
  STROOP_TRAINING_KEY,
} from "@/modules/training/constants";
import { getOwnTrainingTrendsForSubject } from "@/modules/training/session.service";
import { resolveTrainingSubject } from "@/modules/training/training-subject";

const querySchema = z.object({
  trainingKey: z.enum([REACTION_TRAINING_KEY, STROOP_TRAINING_KEY, DIGIT_SPAN_TRAINING_KEY]),
  window: z.enum(["7d", "30d", "all"]).default("7d"),
});

export async function GET(request: Request) {
  try {
    const { db, dbUser } = await requireTraineeSession();
    const url = new URL(request.url);
    const query = querySchema.parse({
      trainingKey: url.searchParams.get("trainingKey"),
      window: url.searchParams.get("window") ?? "7d",
    });

    const subject = await resolveTrainingSubject(db, dbUser.id);
    const trends = await getOwnTrainingTrendsForSubject(db, subject, {
      trainingKey: query.trainingKey,
      window: query.window,
    });
    return NextResponse.json(trends);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
