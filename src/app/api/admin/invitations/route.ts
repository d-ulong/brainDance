import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminSession } from "@/lib/auth-request";
import { toErrorResponse } from "@/lib/http-errors";
import { createInvitation } from "@/modules/identity/invitation.service";

const bodySchema = z.object({
  targetRole: z.enum(["parent", "student", "admin"]),
  maxUses: z.number().int().min(1).max(1000).optional(),
  expiresAt: z.string().datetime().optional(),
  idempotencyKey: z.string().min(8).max(128),
});

export async function POST(request: Request) {
  try {
    const { db, user } = await requireAdminSession();
    const body = bodySchema.parse(await request.json());

    const result = await createInvitation(db, {
      adminId: user.id,
      targetRole: body.targetRole,
      maxUses: body.maxUses,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
      idempotencyKey: body.idempotencyKey,
      requestId: request.headers.get("x-request-id") ?? undefined,
    });

    return NextResponse.json({
      invitationId: result.invitationId,
      targetRole: result.targetRole,
      expiresAt: result.expiresAt.toISOString(),
      maxUses: result.maxUses,
      idempotentReplay: result.idempotentReplay,
      code: result.idempotentReplay ? undefined : result.codePlaintext,
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
