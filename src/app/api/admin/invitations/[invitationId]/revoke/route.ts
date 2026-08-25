import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminSession } from "@/lib/auth-request";
import { toErrorResponse } from "@/lib/http-errors";
import { revokeInvitation } from "@/modules/identity/invitation.service";

const bodySchema = z.object({
  idempotencyKey: z.string().min(8).max(128),
});

type RouteContext = {
  params: Promise<{ invitationId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { db, user } = await requireAdminSession();
    const { invitationId } = await context.params;
    const body = bodySchema.parse(await request.json());

    const result = await revokeInvitation(db, {
      adminId: user.id,
      invitationId,
      idempotencyKey: body.idempotencyKey,
      requestId: request.headers.get("x-request-id") ?? undefined,
    });

    return NextResponse.json({
      invitationId: result.invitationId,
      revokedAt: result.revokedAt.toISOString(),
      idempotentReplay: result.idempotentReplay,
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
