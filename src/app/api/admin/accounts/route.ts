import { ZodError } from "zod";
import { requireAdminSession } from "@/lib/auth-request";
import { toErrorResponse } from "@/lib/http-errors";
import { accountListSchema, listAccounts } from "@/modules/identity/admin-accounts.service";

export async function GET(request: Request) {
  try {
    const { db, dbUser, session } = await requireAdminSession();
    const query = accountListSchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    return Response.json(
      await listAccounts(db, {
        adminId: dbUser.id,
        currentSessionId: session.id,
        ...query,
      }),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const result =
      error instanceof ZodError
        ? { status: 400, body: { error: "账号查询参数不正确", code: "VALIDATION_ERROR" } }
        : toErrorResponse(error);
    return Response.json(result.body, {
      status: result.status,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
