import { NextResponse } from "next/server";

import { executionBodySchema } from "@/modules/schedule/execution-input-schema";
import { m2UuidParamSchema } from "@/app/api/_lib/m2-schemas";
import { requireIdempotencyKey } from "@/app/api/_lib/require-idempotency-key";
import { toRouteErrorResponse } from "@/app/api/_lib/to-route-error-response";
import { requireTraineeSessionForWrites } from "@/lib/auth-request";
import { updateTaskExecution } from "@/modules/schedule/task-execution.service";

export async function POST(request: Request, context: { params: Promise<{ itemId: string }> }) {
  const key = requireIdempotencyKey(request);
  if (!key.ok) return key.response;
  try {
    const { db, dbUser } = await requireTraineeSessionForWrites();
    const { itemId } = await context.params;
    const result = await updateTaskExecution(db, {
      actorId: dbUser.id,
      actorRole: dbUser.role === "parent" ? "parent" : "student",
      scheduleItemId: m2UuidParamSchema.parse(itemId),
      idempotencyKey: key.key,
      ...executionBodySchema.parse(await request.json()),
      correction: true,
      requestId: request.headers.get("x-request-id") ?? undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    const { status, body } = toRouteErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
