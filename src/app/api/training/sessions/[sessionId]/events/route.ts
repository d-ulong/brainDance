import { NextResponse } from "next/server";
import { z } from "zod";

import { requireStudentSession } from "@/lib/auth-request";
import { toErrorResponse } from "@/lib/http-errors";
import { appendTrainingEvent } from "@/modules/training/session.service";

const bodySchema = z.object({
  sequence: z.number().int().min(0),
  eventType: z.string().min(1).max(64),
  payload: z.record(z.unknown()).default({}),
});

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { db, dbUser } = await requireStudentSession();
    const { sessionId } = await context.params;
    const body = bodySchema.parse(await request.json());

    const result = await appendTrainingEvent(db, {
      studentId: dbUser.id,
      sessionId,
      sequence: body.sequence,
      eventType: body.eventType,
      payload: body.payload,
    });

    return NextResponse.json({
      sequence: result.sequence,
      occurredAt: result.occurredAt.toISOString(),
      blurAccumulatedMs: result.blurAccumulatedMs,
      abandoned: result.abandoned,
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
