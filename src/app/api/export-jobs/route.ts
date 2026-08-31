import { NextResponse } from "next/server";

import { m2UuidParamSchema } from "@/app/api/_lib/m2-schemas";
import { createExportJobBodySchema } from "@/app/api/_lib/m6-lifecycle-schemas";
import { requireIdempotencyKey } from "@/app/api/_lib/require-idempotency-key";
import { toRouteErrorResponse } from "@/app/api/_lib/to-route-error-response";
import { requireStudentReadAccess } from "@/app/api/_lib/student-read-access";
import { requireAuthenticatedSession } from "@/lib/auth-request";
import {
  createExportJob,
  listExportJobsForRequester,
} from "@/modules/data-lifecycle/export-job.service";

export async function GET() {
  try {
    const { db, dbUser } = await requireAuthenticatedSession();
    const jobs = await listExportJobsForRequester(db, dbUser.id);
    return NextResponse.json({ jobs });
  } catch (error) {
    const { status, body } = toRouteErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function POST(request: Request) {
  const idempotency = requireIdempotencyKey(request);
  if (!idempotency.ok) {
    return idempotency.response;
  }

  try {
    const { db, dbUser } = await requireAuthenticatedSession();
    const body = createExportJobBodySchema.parse(await request.json());
    const studentId = m2UuidParamSchema.parse(body.studentId);

    await requireStudentReadAccess(db, dbUser, studentId);

    const requesterRole = dbUser.role === "student" ? ("student" as const) : ("parent" as const);

    if (dbUser.role !== "student" && dbUser.role !== "parent") {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: "Export not allowed for this role" } },
        { status: 403 },
      );
    }

    const result = await createExportJob(db, {
      requesterId: dbUser.id,
      requesterRole,
      studentId,
      idempotencyKey: idempotency.key,
      requestId: request.headers.get("x-request-id") ?? undefined,
    });

    return NextResponse.json(result);
  } catch (error) {
    const { status, body } = toRouteErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
