import { z, ZodError } from "zod";
import { requireAdminSession } from "@/lib/auth-request";
import { toErrorResponse } from "@/lib/http-errors";
import {
  resetAccountPassword,
  resetAccountSchema,
} from "@/modules/identity/admin-accounts.service";

export async function POST(request: Request, context: { params: Promise<{ userId: string }> }) {
  try {
    const { db, dbUser, session } = await requireAdminSession();
    const userId = z
      .string()
      .uuid()
      .parse((await context.params).userId);
    const body = resetAccountSchema.parse(await request.json());
    const result = await resetAccountPassword(db, {
      adminId: dbUser.id,
      currentSessionId: session.id,
      userId,
      ...body,
      requestId: request.headers.get("x-request-id") ?? undefined,
    });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const result =
      error instanceof ZodError || error instanceof SyntaxError
        ? { status: 400, body: { error: "重置参数不正确", code: "VALIDATION_ERROR" } }
        : toErrorResponse(error);
    return Response.json(result.body, {
      status: result.status,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
