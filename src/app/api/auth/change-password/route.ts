import { z, ZodError } from "zod";

import { jsonWithSessionCookie, requireAuthenticatedSession } from "@/lib/auth-request";
import { toErrorResponse } from "@/lib/http-errors";
import { changePassword } from "@/modules/identity/change-password.service";
import { PRODUCT_PASSWORD_MAX_LENGTH } from "@/modules/identity/password-policy";

const bodySchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(1).max(PRODUCT_PASSWORD_MAX_LENGTH),
  idempotencyKey: z.string().min(8).max(128),
});

export async function POST(request: Request) {
  try {
    const { db, dbUser, session } = await requireAuthenticatedSession({
      allowPasswordChangeRequired: true,
    });
    const body = bodySchema.parse(await request.json());

    const result = await changePassword(db, {
      userId: dbUser.id,
      currentSessionId: session.id,
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
      idempotencyKey: body.idempotencyKey,
      requestId: request.headers.get("x-request-id") ?? undefined,
    });

    return jsonWithSessionCookie(
      {
        userId: result.userId,
        mustChangePassword: result.mustChangePassword,
        idempotentReplay: result.idempotentReplay,
      },
      result.sessionCookie,
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) {
      return Response.json(
        { error: "改密参数不正确", code: "VALIDATION_ERROR" },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
    const { status, body } = toErrorResponse(error);
    return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  }
}
