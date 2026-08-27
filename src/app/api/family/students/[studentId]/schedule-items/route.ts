import { NextResponse } from "next/server";

import { scheduleItemsQuerySchema } from "@/app/api/_lib/m2-schemas";
import { requireStudentReadAccess } from "@/app/api/_lib/student-read-access";
import { toRouteErrorResponse } from "@/app/api/_lib/to-route-error-response";
import { requireAuthenticatedSession } from "@/lib/auth-request";
import { queryScheduleItems } from "@/modules/schedule/schedule-query.service";

type RouteContext = {
  params: Promise<{ studentId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { db, dbUser } = await requireAuthenticatedSession();
    const { studentId } = await context.params;
    const url = new URL(request.url);
    const query = scheduleItemsQuerySchema.parse({
      from: url.searchParams.get("from"),
      to: url.searchParams.get("to"),
    });

    await requireStudentReadAccess(db, dbUser, studentId);

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
