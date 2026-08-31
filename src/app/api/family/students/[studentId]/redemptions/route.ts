import { NextResponse } from "next/server";

import { m2UuidParamSchema } from "@/app/api/_lib/m2-schemas";
import { createRedemptionBodySchema } from "@/app/api/_lib/m6-schemas";
import { requireIdempotencyKey } from "@/app/api/_lib/require-idempotency-key";
import { toRouteErrorResponse } from "@/app/api/_lib/to-route-error-response";
import { requireStudentReadAccess } from "@/app/api/_lib/student-read-access";
import { requireAuthenticatedSession, requireStudentSessionForWrites } from "@/lib/auth-request";
import { FamilyAccessError } from "@/modules/family-access/errors";
import { createRedemptionRequest, listRedemptions } from "@/modules/redemption/redemption.service";

type RouteContext = {
  params: Promise<{ studentId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { db, dbUser } = await requireAuthenticatedSession();
    const { studentId: rawStudentId } = await context.params;
    const studentId = m2UuidParamSchema.parse(rawStudentId);
    await requireStudentReadAccess(db, dbUser, studentId);

    const redemptions = await listRedemptions(db, studentId);
    return NextResponse.json({ redemptions });
  } catch (error) {
    const { status, body } = toRouteErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function POST(request: Request, context: RouteContext) {
  const idempotency = requireIdempotencyKey(request);
  if (!idempotency.ok) {
    return idempotency.response;
  }

  try {
    const { db, dbUser } = await requireStudentSessionForWrites();
    const { studentId: rawStudentId } = await context.params;
    const studentId = m2UuidParamSchema.parse(rawStudentId);
    const body = createRedemptionBodySchema.parse(await request.json());

    if (dbUser.role !== "student" || dbUser.id !== studentId) {
      throw new FamilyAccessError("FORBIDDEN", "Student access denied");
    }

    const result = await createRedemptionRequest(db, {
      studentId,
      actorId: dbUser.id,
      catalogItemId: body.catalogItemId,
      idempotencyKey: idempotency.key,
      requestId: request.headers.get("x-request-id") ?? undefined,
    });

    return NextResponse.json(result);
  } catch (error) {
    const { status, body } = toRouteErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
