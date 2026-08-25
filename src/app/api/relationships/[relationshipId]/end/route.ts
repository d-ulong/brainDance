import { z } from "zod";

import {
  jsonWithSessionCookie,
  refreshSessionCookieAfterEpochChange,
  requireAuthenticatedSession,
} from "@/lib/auth-request";
import { toErrorResponse } from "@/lib/http-errors";
import { FamilyAccessError } from "@/modules/family-access/errors";
import { endRelationship } from "@/modules/family-access/end-relationship.service";

const bodySchema = z.object({
  idempotencyKey: z.string().min(8).max(128),
});

type RouteContext = {
  params: Promise<{ relationshipId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { db, dbUser, session } = await requireAuthenticatedSession();
    if (dbUser.role !== "parent" && dbUser.role !== "student") {
      throw new FamilyAccessError("FORBIDDEN", "Only parent or student can end a relationship");
    }

    const { relationshipId } = await context.params;
    const body = bodySchema.parse(await request.json());

    const result = await endRelationship(db, {
      actorId: dbUser.id,
      relationshipId,
      idempotencyKey: body.idempotencyKey,
      requestId: request.headers.get("x-request-id") ?? undefined,
    });

    const sessionCookie = await refreshSessionCookieAfterEpochChange(db, dbUser.id, session.id);

    return jsonWithSessionCookie(
      {
        relationshipId: result.relationshipId,
        status: result.status,
        idempotentReplay: result.idempotentReplay,
      },
      sessionCookie,
    );
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return Response.json(body, { status });
  }
}
