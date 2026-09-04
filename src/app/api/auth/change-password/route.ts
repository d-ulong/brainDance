import { z } from "zod";

import { jsonWithSessionCookie, requireAuthenticatedSession } from "@/lib/auth-request";
import { toErrorResponse } from "@/lib/http-errors";
import { changePassword } from "@/modules/identity/change-password.service";
import { IdentityError } from "@/modules/identity/errors";
import { PRODUCT_PASSWORD_MAX_LENGTH } from "@/modules/identity/password-policy";

const bodySchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(1).max(PRODUCT_PASSWORD_MAX_LENGTH),
  idempotencyKey: z.string().min(8).max(128),
});

export async function POST(request: Request) {
  try {
    const { db, dbUser, session } = await requireAuthenticatedSession();
    if (dbUser.role !== "student" && dbUser.role !== "parent") {
      throw new IdentityError(
        "FORBIDDEN",
        "Only students or parents can change their own password",
      );
    }
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
    );
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return Response.json(body, { status });
  }
}
