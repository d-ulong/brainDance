import { NextResponse } from "next/server";
import { z } from "zod";

import { requireStudentSessionForWrites } from "@/lib/auth-request";
import { toErrorResponse } from "@/lib/http-errors";
import { m2UuidParamSchema } from "@/app/api/_lib/m2-schemas";
import { ReflectionPrivacyError } from "@/modules/reflection-privacy/errors";
import { revokePrivateAccess } from "@/modules/reflection-privacy/grant-private-access.service";

const familyDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const revokeBodySchema = z.object({
  idempotencyKey: z.string().min(8).max(128),
});

type RouteContext = {
  params: Promise<{ studentId: string; familyDate: string; parentId: string }>;
};

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const { db, dbUser } = await requireStudentSessionForWrites();
    const { studentId, familyDate, parentId } = await context.params;
    m2UuidParamSchema.parse(studentId);
    m2UuidParamSchema.parse(parentId);
    familyDateSchema.parse(familyDate);

    if (dbUser.id !== studentId) {
      throw new ReflectionPrivacyError("FORBIDDEN", "Student access denied");
    }

    const body = revokeBodySchema.parse(await request.json());
    const result = await revokePrivateAccess(db, {
      studentId,
      familyDate,
      parentId,
      idempotencyKey: body.idempotencyKey,
      requestId: request.headers.get("x-request-id") ?? undefined,
    });

    return NextResponse.json(result);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
