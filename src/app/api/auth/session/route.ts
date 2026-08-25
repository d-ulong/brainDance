import { eq } from "drizzle-orm";
import { z } from "zod";

import { users } from "@/db/schema";
import { clearSessionCookie, requireAuthenticatedSession } from "@/lib/auth-request";
import { createLucia } from "@/lib/lucia";
import { toErrorResponse } from "@/lib/http-errors";
import { logout } from "@/modules/identity/login.service";

const bodySchema = z.object({
  idempotencyKey: z.string().min(8).max(128).optional(),
});

export async function POST(request: Request) {
  try {
    const { db, user, session } = await requireAuthenticatedSession();
    const body = bodySchema.parse(await request.json().catch(() => ({})));

    await logout(db, {
      sessionId: session.id,
      actorId: user.id,
      idempotencyKey: body.idempotencyKey,
      requestId: request.headers.get("x-request-id") ?? undefined,
    });

    const lucia = createLucia(db);
    return clearSessionCookie(lucia.sessionCookieName);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return Response.json(body, { status });
  }
}

export async function GET() {
  try {
    const { db, user } = await requireAuthenticatedSession();
    const [dbUser] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);

    return Response.json({
      userId: user.id,
      role: user.role,
      contactVerified: user.role === "admin" || Boolean(dbUser?.contactVerifiedAt),
      status: dbUser?.status,
      authorizationEpoch: user.authorizationEpoch,
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return Response.json(body, { status });
  }
}
