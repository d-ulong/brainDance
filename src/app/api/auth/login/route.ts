import { z } from "zod";

import { getDb } from "@/db";
import { jsonWithSessionCookie } from "@/lib/auth-request";
import { toErrorResponse } from "@/lib/http-errors";
import { login } from "@/modules/identity/login.service";

const bodySchema = z.object({
  identifier: z.string().min(3).max(128),
  password: z.string().min(1).max(128),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

export async function POST(request: Request) {
  try {
    const db = getDb();
    const body = bodySchema.parse(await request.json());

    const result = await login(db, {
      identifier: body.identifier,
      password: body.password,
      ipAddress: request.headers.get("x-forwarded-for") ?? undefined,
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
    const { status, body } = toErrorResponse(error);
    return Response.json(body, { status });
  }
}
