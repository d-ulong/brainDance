import { NextResponse } from "next/server";
import { z } from "zod";

import { m2UuidParamSchema } from "@/app/api/_lib/m2-schemas";
import { requireIdempotencyKey } from "@/app/api/_lib/require-idempotency-key";
import { toRouteErrorResponse } from "@/app/api/_lib/to-route-error-response";
import { requireAuthenticatedSession, requireStudentSessionForWrites } from "@/lib/auth-request";
import { getPushAnswer, submitPushAnswer } from "@/modules/family-content/answer.service";
import { getFamilyPush } from "@/modules/family-content/push-lifecycle.service";
import { FamilyContentError } from "@/modules/family-content/errors";

const submitBodySchema = z.object({
  body: z.string().optional().nullable(),
  mediaIds: z.array(z.string().uuid()).max(1).optional().nullable(),
  handwritingMediaIds: z.array(z.string().uuid()).max(1).optional().nullable(),
});

type RouteContext = {
  params: Promise<{ studentId: string; pushId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { db, dbUser } = await requireAuthenticatedSession();
    const { studentId: rawStudentId, pushId: rawPushId } = await context.params;
    const studentId = m2UuidParamSchema.parse(rawStudentId);
    const pushId = m2UuidParamSchema.parse(rawPushId);

    if (dbUser.role !== "parent" && dbUser.role !== "student") {
      throw new FamilyContentError("FORBIDDEN", "Access denied");
    }

    const push = await getFamilyPush(db, {
      actorId: dbUser.id,
      actorRole: dbUser.role,
      pushId,
    });
    if (push.studentId !== studentId) {
      throw new FamilyContentError("NOT_FOUND", "Push not found");
    }

    const answer = await getPushAnswer(db, pushId);
    return NextResponse.json({ answer });
  } catch (error) {
    const { status, body } = toRouteErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function POST(request: Request, context: RouteContext) {
  const idempotency = requireIdempotencyKey(request);
  if (!idempotency.ok) {
    return idempotency.response;
  }

  try {
    const { db, dbUser } = await requireStudentSessionForWrites();
    const { studentId: rawStudentId, pushId: rawPushId } = await context.params;
    const studentId = m2UuidParamSchema.parse(rawStudentId);
    const pushId = m2UuidParamSchema.parse(rawPushId);

    if (dbUser.id !== studentId) {
      throw new FamilyContentError("FORBIDDEN", "Access denied");
    }

    const parsed = submitBodySchema.parse(await request.json());
    const result = await submitPushAnswer(db, {
      studentId,
      pushId,
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
