import { NextResponse } from "next/server";
import { z } from "zod";

import { requireTraineeSessionForWrites } from "@/lib/auth-request";
import { toErrorResponse } from "@/lib/http-errors";
import { startTrainingSessionForSubject } from "@/modules/training/session.service";
import { resolveTrainingSubject } from "@/modules/training/training-subject";

const bodySchema = z.object({
  trainingKey: z.string().min(1).max(64),
  idempotencyKey: z.string().min(8).max(128),
});

export async function POST(request: Request) {
  try {
    const { db, dbUser } = await requireTraineeSessionForWrites();
    const body = bodySchema.parse(await request.json());
    const subject = await resolveTrainingSubject(db, dbUser.id);

    const result = await startTrainingSessionForSubject(db, {
      subject,
      trainingKey: body.trainingKey,
      idempotencyKey: body.idempotencyKey,
      requestId: request.headers.get("x-request-id") ?? undefined,
    });

    return NextResponse.json(result);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
