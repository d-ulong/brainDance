import { z } from "zod";

import { requireAuthenticatedSession } from "@/lib/auth-request";
import { toErrorResponse } from "@/lib/http-errors";
import { verifyContact } from "@/modules/identity/verification.service";

const bodySchema = z.object({
  otp: z.string().regex(/^\d{6}$/),
  idempotencyKey: z.string().min(8).max(128),
});

export async function POST(request: Request) {
  try {
    const { db, user } = await requireAuthenticatedSession();
    const body = bodySchema.parse(await request.json());

    const result = await verifyContact(db, {
      userId: user.id,
      otp: body.otp,
      idempotencyKey: body.idempotencyKey,
      requestId: request.headers.get("x-request-id") ?? undefined,
    });

    return Response.json({
      userId: result.userId,
      verifiedAt: result.verifiedAt.toISOString(),
      idempotentReplay: result.idempotentReplay,
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return Response.json(body, { status });
  }
}
