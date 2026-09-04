import { NextResponse } from "next/server";
import { z } from "zod";

import { requireTraineeSession } from "@/lib/auth-request";
import { toErrorResponse } from "@/lib/http-errors";
import {
  DIGIT_SPAN_TRAINING_KEY,
  REACTION_TRAINING_KEY,
  STROOP_TRAINING_KEY,
} from "@/modules/training/constants";
import { getTrainingSummaryForSubject } from "@/modules/training/session.service";
import { resolveTrainingSubject } from "@/modules/training/training-subject";

const querySchema = z.object({
  trainingKey: z.enum([REACTION_TRAINING_KEY, STROOP_TRAINING_KEY, DIGIT_SPAN_TRAINING_KEY]),
});

export async function GET(request: Request) {
  try {
    const { db, dbUser } = await requireTraineeSession();
    const url = new URL(request.url);
    const query = querySchema.parse({
      trainingKey: url.searchParams.get("trainingKey") ?? REACTION_TRAINING_KEY,
    });

    const subject = await resolveTrainingSubject(db, dbUser.id);
    const summary = await getTrainingSummaryForSubject(db, subject, query.trainingKey);
    return NextResponse.json(summary);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
