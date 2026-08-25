import { NextResponse } from "next/server";
import { z } from "zod";

import { requireStudentSession } from "@/lib/auth-request";
import { toErrorResponse } from "@/lib/http-errors";
import { acceptRelationshipRequest } from "@/modules/family-access/relationship-request.service";

const bodySchema = z.object({
  idempotencyKey: z.string().min(8).max(128),
});

type RouteContext = {
  params: Promise<{ requestId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { db, dbUser } = await requireStudentSession();
    const { requestId } = await context.params;
    const body = bodySchema.parse(await request.json());

    const result = await acceptRelationshipRequest(db, {
      studentId: dbUser.id,
      requestId,
      idempotencyKey: body.idempotencyKey,
      requestIdHeader: request.headers.get("x-request-id") ?? undefined,
    });

    return NextResponse.json({
      relationshipId: result.relationshipId,
      familyId: result.familyId,
      idempotentReplay: result.idempotentReplay,
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
