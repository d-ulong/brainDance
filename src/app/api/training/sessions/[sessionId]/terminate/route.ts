import { NextResponse } from "next/server";
import { z } from "zod";

import { requireTraineeSessionForWrites } from "@/lib/auth-request";
import { toErrorResponse } from "@/lib/http-errors";
import {
  abandonTrainingSessionForSubject,
  cancelTrainingSessionForSubject,
} from "@/modules/training/session.service";
import { resolveTrainingSubject } from "@/modules/training/training-subject";

const bodySchema = z.object({
  action: z.enum(["cancel", "abandon"]),
  reason: z.string().max(256).optional(),
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

    const result =
      body.action === "cancel"
        ? await cancelTrainingSessionForSubject(db, {
            subject,
            sessionId,
            requestId: request.headers.get("x-request-id") ?? undefined,
          })
        : await abandonTrainingSessionForSubject(db, {
            subject,
            sessionId,
            reason: body.reason,
            requestId: request.headers.get("x-request-id") ?? undefined,
          });

    return NextResponse.json(result);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
