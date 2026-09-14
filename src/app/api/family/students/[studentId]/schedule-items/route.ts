import { NextResponse } from "next/server";

import { m2UuidParamSchema, scheduleItemsQuerySchema } from "@/app/api/_lib/m2-schemas";
import { requireStudentReadAccess } from "@/app/api/_lib/student-read-access";
import { toRouteErrorResponse } from "@/app/api/_lib/to-route-error-response";
import { requireAuthenticatedSession, requireTraineeSessionForWrites } from "@/lib/auth-request";
import { requireIdempotencyKey } from "@/app/api/_lib/require-idempotency-key";
import { clearScheduleItems } from "@/modules/schedule/clear-schedule.service";
import { z } from "zod";
import { queryScheduleItems } from "@/modules/schedule/schedule-query.service";

type RouteContext = {
  params: Promise<{ studentId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { db, dbUser } = await requireAuthenticatedSession();
    const { studentId: rawStudentId } = await context.params;
    const studentId = m2UuidParamSchema.parse(rawStudentId);
    const url = new URL(request.url);
    const query = scheduleItemsQuerySchema.parse({
      from: url.searchParams.get("from"),
      to: url.searchParams.get("to"),
    });

    if (!(dbUser.role === "parent" && dbUser.id === studentId)) {
      await requireStudentReadAccess(db, dbUser, studentId);
    }

    const items = await queryScheduleItems(db, {
      studentId,
      from: query.from,
      to: query.to,
    });

    return NextResponse.json({ items });
  } catch (error) {
    const { status, body } = toRouteErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

const clearBodySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  through: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).strict();

export async function DELETE(request: Request, context: RouteContext) {
  const idempotency = requireIdempotencyKey(request);
  if (!idempotency.ok) return idempotency.response;
  try {
    const { db, dbUser } = await requireTraineeSessionForWrites();
    const { studentId: rawStudentId } = await context.params;
    const studentId = m2UuidParamSchema.parse(rawStudentId);
    const body = clearBodySchema.parse(await request.json());
    return NextResponse.json(await clearScheduleItems(db, {
      actorId: dbUser.id,
      actorRole: dbUser.role,
      studentId,
      from: body.from,
      through: body.through,
      idempotencyKey: idempotency.key,
      requestId: request.headers.get("x-request-id") ?? undefined,
    }));
  } catch (error) {
    const { status, body } = toRouteErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
