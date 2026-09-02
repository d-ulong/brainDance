import { NextResponse } from "next/server";
import { z } from "zod";

import { m2UuidParamSchema } from "@/app/api/_lib/m2-schemas";
import { requireIdempotencyKey } from "@/app/api/_lib/require-idempotency-key";
import { toRouteErrorResponse } from "@/app/api/_lib/to-route-error-response";
import { requireAuthenticatedSession } from "@/lib/auth-request";
import { createPushComment, listPushComments } from "@/modules/family-content/comment.service";
import { FamilyContentError } from "@/modules/family-content/errors";

const createBodySchema = z.object({
  body: z.string(),
  parentCommentId: z.string().uuid().optional().nullable(),
});

type RouteContext = {
  params: Promise<{ studentId: string; pushId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { db, dbUser } = await requireAuthenticatedSession();
    const { pushId: rawPushId } = await context.params;
    const pushId = m2UuidParamSchema.parse(rawPushId);

    if (dbUser.role !== "parent" && dbUser.role !== "student") {
      throw new FamilyContentError("FORBIDDEN", "Access denied");
    }

    const comments = await listPushComments(db, {
      actorId: dbUser.id,
      actorRole: dbUser.role,
      pushId,
    });

    return NextResponse.json({ comments });
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
    const { db, dbUser } = await requireAuthenticatedSession();
    const { pushId: rawPushId } = await context.params;
    const pushId = m2UuidParamSchema.parse(rawPushId);
    const parsed = createBodySchema.parse(await request.json());

    if (dbUser.role !== "parent" && dbUser.role !== "student") {
      throw new FamilyContentError("FORBIDDEN", "Access denied");
    }

    if (dbUser.role === "parent" && !dbUser.contactVerifiedAt) {
      throw new FamilyContentError("FORBIDDEN", "Contact verification required");
    }

    const result = await createPushComment(db, {
      actorId: dbUser.id,
      actorRole: dbUser.role,
      pushId,
      body: parsed.body,
      parentCommentId: parsed.parentCommentId,
      idempotencyKey: idempotency.key,
      requestId: request.headers.get("x-request-id") ?? undefined,
    });

    return NextResponse.json({
      ...result.comment,
      idempotentReplay: result.idempotentReplay,
    });
  } catch (error) {
    const { status, body } = toRouteErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
