import { NextResponse } from "next/server";
import { z } from "zod";

import { m2UuidParamSchema } from "@/app/api/_lib/m2-schemas";
import { requireIdempotencyKey } from "@/app/api/_lib/require-idempotency-key";
import { toRouteErrorResponse } from "@/app/api/_lib/to-route-error-response";
import { requireAuthenticatedSession, requireVerifiedParentSession } from "@/lib/auth-request";
import {
  editFamilyPush,
  getFamilyPush,
  transitionFamilyPush,
} from "@/modules/family-content/push-lifecycle.service";
import { FamilyContentError } from "@/modules/family-content/errors";

const editBodySchema = z.object({
  body: z.string().optional().nullable(),
  linkUrl: z.string().optional().nullable(),
  scheduledPublishAt: z.string().datetime().optional().nullable(),
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

    return NextResponse.json(push);
  } catch (error) {
    const { status, body } = toRouteErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const idempotency = requireIdempotencyKey(request);
  if (!idempotency.ok) {
    return idempotency.response;
  }

  try {
    const { db, dbUser } = await requireVerifiedParentSession();
    const { pushId: rawPushId } = await context.params;
    const pushId = m2UuidParamSchema.parse(rawPushId);
    const parsed = editBodySchema.parse(await request.json());

    const result = await editFamilyPush(db, {
      actorId: dbUser.id,
      pushId,
      body: parsed.body,
      linkUrl: parsed.linkUrl,
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

export async function DELETE(request: Request, context: RouteContext) {
  const idempotency = requireIdempotencyKey(request);
  if (!idempotency.ok) {
    return idempotency.response;
  }

  try {
    const { db, dbUser } = await requireVerifiedParentSession();
    const { pushId: rawPushId } = await context.params;
    const pushId = m2UuidParamSchema.parse(rawPushId);

    const result = await transitionFamilyPush(db, {
      actorId: dbUser.id,
      pushId,
      action: "delete",
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
