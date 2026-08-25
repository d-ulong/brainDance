import { NextResponse } from "next/server";
import { z } from "zod";

import { requireStudentSession } from "@/lib/auth-request";
import { toErrorResponse } from "@/lib/http-errors";
import { startTrainingSession } from "@/modules/training/session.service";

const bodySchema = z.object({
  trainingKey: z.string().min(1).max(64),
  idempotencyKey: z.string().min(8).max(128),
});

export async function POST(request: Request) {
  try {
    const { db, dbUser } = await requireStudentSession();
    const body = bodySchema.parse(await request.json());

    const result = await startTrainingSession(db, {
      studentId: dbUser.id,
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
