import { NextResponse } from "next/server";

import { m2UuidParamSchema } from "@/app/api/_lib/m2-schemas";
import { requireIdempotencyKey } from "@/app/api/_lib/require-idempotency-key";
import { toRouteErrorResponse } from "@/app/api/_lib/to-route-error-response";
import { requireTraineeSessionForWrites } from "@/lib/auth-request";
import { completeScheduleItem } from "@/modules/schedule/complete-schedule.service";
import { z } from "zod";

const completeBodySchema = z.object({
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  durationMinutes: z.number().positive().max(1_440).optional(),
}).strict().superRefine((value, context) => {
  if (value.completedAt && value.durationMinutes !== undefined) {
    context.addIssue({ code: "custom", message: "结束时间和完成时长只能填写一项" });
  }
});

type RouteContext = {
  params: Promise<{ itemId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const idempotency = requireIdempotencyKey(request);
  if (!idempotency.ok) {
    return idempotency.response;
  }

  try {
    const { db, dbUser } = await requireTraineeSessionForWrites();
    const { itemId: rawItemId } = await context.params;
    const itemId = m2UuidParamSchema.parse(rawItemId);

    let body: z.infer<typeof completeBodySchema> = {};
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const parsed = await request.json();
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        body = completeBodySchema.parse(parsed);
      }
    }

    const result = await completeScheduleItem(db, {
      actorId: dbUser.id,
      actorRole: dbUser.role === "parent" ? "parent" : "student",
      scheduleItemId: itemId,
      idempotencyKey: idempotency.key,
      body,
      requestId: request.headers.get("x-request-id") ?? undefined,
    });

    return NextResponse.json(result);
  } catch (error) {
    const { status, body } = toRouteErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
