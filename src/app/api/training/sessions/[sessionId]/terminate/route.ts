import { NextResponse } from "next/server";
import { z } from "zod";

import { requireStudentSessionForWrites } from "@/lib/auth-request";
import { toErrorResponse } from "@/lib/http-errors";
import { abandonTrainingSession, cancelTrainingSession } from "@/modules/training/session.service";

const bodySchema = z.object({
  action: z.enum(["cancel", "abandon"]),
  reason: z.string().max(256).optional(),
});

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { db, dbUser } = await requireStudentSessionForWrites();
    const { sessionId } = await context.params;
    const body = bodySchema.parse(await request.json());

    const result =
      body.action === "cancel"
        ? await cancelTrainingSession(db, {
            studentId: dbUser.id,
            sessionId,
            requestId: request.headers.get("x-request-id") ?? undefined,
          })
        : await abandonTrainingSession(db, {
            studentId: dbUser.id,
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
