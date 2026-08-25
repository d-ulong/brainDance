import { z } from "zod";

import { requireAuthenticatedSession } from "@/lib/auth-request";
import { toErrorResponse } from "@/lib/http-errors";
import { issueContactVerification } from "@/modules/identity/verification.service";

const bodySchema = z.object({
  idempotencyKey: z.string().min(8).max(128),
});

export async function POST(request: Request) {
  try {
    const { db, user } = await requireAuthenticatedSession();
    const body = bodySchema.parse(await request.json());

    const result = await issueContactVerification(db, {
      userId: user.id,
      idempotencyKey: body.idempotencyKey,
      requestId: request.headers.get("x-request-id") ?? undefined,
    });

    return Response.json({
      verificationId: result.verificationId,
      expiresAt: result.expiresAt.toISOString(),
      idempotentReplay: result.idempotentReplay,
      devOtp: result.devOtpPlaintext,
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return Response.json(body, { status });
  }
}
