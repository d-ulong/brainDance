import { NextResponse } from "next/server";
import { z } from "zod";

import { m2UuidParamSchema } from "@/app/api/_lib/m2-schemas";
import { requireIdempotencyKey } from "@/app/api/_lib/require-idempotency-key";
import { toRouteErrorResponse } from "@/app/api/_lib/to-route-error-response";
import { requireParentSession, requireVerifiedParentSession } from "@/lib/auth-request";
import { createFamilyPush } from "@/modules/family-content/create-push.service";
import { listFamilyPushes } from "@/modules/family-content/push-lifecycle.service";

const createBodySchema = z.object({
  body: z.string().optional().nullable(),
  linkUrl: z.string().optional().nullable(),
  mediaIds: z.array(z.string().uuid()).max(1).optional().nullable(),
  publishMode: z.enum(["draft", "immediate", "scheduled"]),
  scheduledPublishAt: z.string().datetime().optional().nullable(),
});

type RouteContext = {
  params: Promise<{ studentId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { db, dbUser } = await requireParentSession();
    const { studentId: rawStudentId } = await context.params;
    const studentId = m2UuidParamSchema.parse(rawStudentId);

    const pushes = await listFamilyPushes(db, {
      actorId: dbUser.id,
      actorRole: "parent",
      studentId,
    });

    return NextResponse.json({ pushes });
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
    const { db, dbUser } = await requireVerifiedParentSession();
    const { studentId: rawStudentId } = await context.params;
    const studentId = m2UuidParamSchema.parse(rawStudentId);
    const parsed = createBodySchema.parse(await request.json());

    const result = await createFamilyPush(db, {
      actorId: dbUser.id,
      studentId,
      body: parsed.body,
      linkUrl: parsed.linkUrl,
      mediaIds: parsed.mediaIds,
      publishMode: parsed.publishMode,
      scheduledPublishAt: parsed.scheduledPublishAt,
      idempotencyKey: idempotency.key,
      requestId: request.headers.get("x-request-id") ?? undefined,
    });

    return NextResponse.json({
      ...result.push,
      idempotentReplay: result.idempotentReplay,
    });
  } catch (error) {
    const { status, body } = toRouteErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
