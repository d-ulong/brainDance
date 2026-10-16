import { z } from "zod";

import { getDb } from "@/db";
import { jsonWithSessionCookie } from "@/lib/auth-request";
import { toErrorResponse } from "@/lib/http-errors";
import { login } from "@/modules/identity/login.service";
import { IdentityError } from "@/modules/identity/errors";
import { trustedClientIp } from "@/modules/identity/trusted-client-ip";

const bodySchema = z.object({
  identifier: z.string().min(3).max(128),
  password: z.string().min(1).max(128),
  totpCode: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

export async function POST(request: Request) {
  try {
    const db = getDb();
    const body = bodySchema.parse(await request.json());

    const result = await login(db, {
      identifier: body.identifier,
      password: body.password,
      ipAddress: trustedClientIp(request.headers),
      totpCode: body.totpCode,
      idempotencyKey: body.idempotencyKey,
      requestId: request.headers.get("x-request-id") ?? undefined,
    });

    return jsonWithSessionCookie(
      {
        userId: result.userId,
        contactVerified: result.contactVerified,
      },
      result.sessionCookie,
    );
  } catch (error) {
    if (error instanceof IdentityError && error.code === "MFA_REQUIRED") {
      return Response.json({ mfaRequired: true, method: "totp" });
    }
    if (error instanceof z.ZodError)
      return Response.json(
        { code: "VALIDATION_ERROR", error: "请检查账号、密码和验证码格式" },
        { status: 400 },
      );
    const { status, body } = toErrorResponse(error);
    return Response.json(body, { status });
  }
}
