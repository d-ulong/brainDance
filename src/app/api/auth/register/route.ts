import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@/db";
import { users } from "@/db/schema";
import { jsonWithSessionCookie } from "@/lib/auth-request";
import { toErrorResponse } from "@/lib/http-errors";
import { login } from "@/modules/identity/login.service";
import { PRODUCT_PASSWORD_MAX_LENGTH } from "@/modules/identity/password-policy";
import { registerParent } from "@/modules/identity/registration.service";

const bodySchema = z
  .object({
    invitationCode: z.string().min(8).max(128),
    displayName: z.string().min(1).max(64),
    email: z.string().email().optional(),
    phone: z.string().min(6).max(32).optional(),
    password: z.string().min(1).max(PRODUCT_PASSWORD_MAX_LENGTH),
    idempotencyKey: z.string().min(8).max(128),
  })
  .refine((value) => Boolean(value.email) !== Boolean(value.phone), {
    message: "Provide exactly one of email or phone",
  });

export async function POST(request: Request) {
  try {
    const db = getDb();
    const body = bodySchema.parse(await request.json());

    const result = await registerParent(db, {
      invitationCode: body.invitationCode,
      displayName: body.displayName,
      email: body.email,
      phone: body.phone,
      password: body.password,
      idempotencyKey: body.idempotencyKey,
      requestId: request.headers.get("x-request-id") ?? undefined,
    });

    const identifier = body.email ?? body.phone!;
    const session = await login(db, {
      identifier,
      password: body.password,
      idempotencyKey: `register-login:${body.idempotencyKey}`,
      requestId: request.headers.get("x-request-id") ?? undefined,
    });

    const [dbUser] = await db.select().from(users).where(eq(users.id, result.userId)).limit(1);

    return jsonWithSessionCookie(
      {
        userId: result.userId,
        status: dbUser?.status ?? result.status,
        contactType: result.contactType,
        contactVerified: Boolean(dbUser?.contactVerifiedAt),
        idempotentReplay: result.idempotentReplay,
      },
      session.sessionCookie,
    );
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return Response.json(body, { status });
  }
}
