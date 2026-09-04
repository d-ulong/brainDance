import { NextResponse } from "next/server";
import { z } from "zod";

import { requireTraineeSessionForWrites } from "@/lib/auth-request";
import { toErrorResponse } from "@/lib/http-errors";
import { submitTrainingSessionForSubject } from "@/modules/training/session.service";
import { resolveTrainingSubject } from "@/modules/training/training-subject";

const bodySchema = z.object({
  idempotencyKey: z.string().min(8).max(128),
});

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { db, dbUser } = await requireTraineeSessionForWrites();
    const { sessionId } = await context.params;
    const body = bodySchema.parse(await request.json());
    const subject = await resolveTrainingSubject(db, dbUser.id);

    const result = await submitTrainingSessionForSubject(db, {
      subject,
      sessionId,
      idempotencyKey: body.idempotencyKey,
      requestId: request.headers.get("x-request-id") ?? undefined,
    });

    return NextResponse.json(result);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
