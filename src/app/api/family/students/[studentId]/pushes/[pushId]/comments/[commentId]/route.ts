import { NextResponse } from "next/server";
import { z } from "zod";

import { m2UuidParamSchema } from "@/app/api/_lib/m2-schemas";
import { requireIdempotencyKey } from "@/app/api/_lib/require-idempotency-key";
import { toRouteErrorResponse } from "@/app/api/_lib/to-route-error-response";
import { requireAuthenticatedSession } from "@/lib/auth-request";
import { mutatePushComment } from "@/modules/family-content/comment.service";
import { FamilyContentError } from "@/modules/family-content/errors";

const mutateBodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("edit"),
    body: z.string(),
  }),
  z.object({
    action: z.literal("delete"),
  }),
]);

type RouteContext = {
  params: Promise<{ studentId: string; pushId: string; commentId: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const idempotency = requireIdempotencyKey(request);
  if (!idempotency.ok) {
    return idempotency.response;
  }

  try {
    const { db, dbUser } = await requireAuthenticatedSession();
    const { commentId: rawCommentId } = await context.params;
    const commentId = m2UuidParamSchema.parse(rawCommentId);
    const parsed = mutateBodySchema.parse(await request.json());

    if (dbUser.role !== "parent" && dbUser.role !== "student") {
      throw new FamilyContentError("FORBIDDEN", "Access denied");
    }

    const result = await mutatePushComment(db, {
      actorId: dbUser.id,
      commentId,
      body: parsed.action === "edit" ? parsed.body : undefined,
      delete: parsed.action === "delete",
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
