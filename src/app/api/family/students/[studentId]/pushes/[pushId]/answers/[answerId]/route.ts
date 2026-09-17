import { NextResponse } from "next/server";
import { z } from "zod";

import { m2UuidParamSchema } from "@/app/api/_lib/m2-schemas";
import { requireIdempotencyKey } from "@/app/api/_lib/require-idempotency-key";
import { toRouteErrorResponse } from "@/app/api/_lib/to-route-error-response";
import { requireStudentSessionForWrites } from "@/lib/auth-request";
import { editPushAnswer } from "@/modules/family-content/answer.service";
import { FamilyContentError } from "@/modules/family-content/errors";

const editBodySchema = z.object({
  body: z.string().optional().nullable(),
  mediaIds: z.array(z.string().uuid()).max(1).optional().nullable(),
  handwritingMediaIds: z.array(z.string().uuid()).max(1).optional().nullable(),
});

type RouteContext = {
  params: Promise<{ studentId: string; pushId: string; answerId: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const idempotency = requireIdempotencyKey(request);
  if (!idempotency.ok) {
    return idempotency.response;
  }

  try {
    const { db, dbUser } = await requireStudentSessionForWrites();
    const {
      studentId: rawStudentId,
      pushId: rawPushId,
      answerId: rawAnswerId,
    } = await context.params;
    const studentId = m2UuidParamSchema.parse(rawStudentId);
    m2UuidParamSchema.parse(rawPushId);
    const answerId = m2UuidParamSchema.parse(rawAnswerId);

    if (dbUser.id !== studentId) {
      throw new FamilyContentError("FORBIDDEN", "Access denied");
    }

    const parsed = editBodySchema.parse(await request.json());
    const result = await editPushAnswer(db, {
      studentId,
      answerId,
      body: parsed.body,
      mediaIds: parsed.mediaIds,
      handwritingMediaIds: parsed.handwritingMediaIds,
      idempotencyKey: idempotency.key,
      requestId: request.headers.get("x-request-id") ?? undefined,
    });

    return NextResponse.json({
      ...result.answer,
      idempotentReplay: result.idempotentReplay,
    });
  } catch (error) {
    const { status, body } = toRouteErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
