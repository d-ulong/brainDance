import { NextResponse } from "next/server";

import { m2UuidParamSchema } from "@/app/api/_lib/m2-schemas";
import { createRedemptionCatalogBodySchema } from "@/app/api/_lib/m6-schemas";
import { requireIdempotencyKey } from "@/app/api/_lib/require-idempotency-key";
import { requireStudentReadAccess } from "@/app/api/_lib/student-read-access";
import { toRouteErrorResponse } from "@/app/api/_lib/to-route-error-response";
import { requireAuthenticatedSession, requireVerifiedParentSession } from "@/lib/auth-request";
import { createCatalogItem, listCatalogItems } from "@/modules/redemption/catalog.service";

type RouteContext = {
  params: Promise<{ studentId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { db, dbUser } = await requireAuthenticatedSession();
    const { studentId: rawStudentId } = await context.params;
    const studentId = m2UuidParamSchema.parse(rawStudentId);
    await requireStudentReadAccess(db, dbUser, studentId);

    const url = new URL(request.url);
    const activeOnly = url.searchParams.get("activeOnly") === "true";

    const items = await listCatalogItems(db, studentId, { activeOnly });
    return NextResponse.json({ items });
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
    const { db, dbUser } = await requireVerifiedParentSession();
    const { studentId: rawStudentId } = await context.params;
    const studentId = m2UuidParamSchema.parse(rawStudentId);
    const body = createRedemptionCatalogBodySchema.parse(await request.json());

    const result = await createCatalogItem(db, {
      parentId: dbUser.id,
      studentId,
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
