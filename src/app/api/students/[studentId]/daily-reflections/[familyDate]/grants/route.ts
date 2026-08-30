import { NextResponse } from "next/server";
import { z } from "zod";

import { requireStudentSessionForWrites } from "@/lib/auth-request";
import { toErrorResponse } from "@/lib/http-errors";
import { m2UuidParamSchema } from "@/app/api/_lib/m2-schemas";
import { ReflectionPrivacyError } from "@/modules/reflection-privacy/errors";
import {
  listActiveParentsForStudent,
  listReflectionGrants,
} from "@/modules/reflection-privacy/get-daily-reflection.service";
import { grantPrivateAccess } from "@/modules/reflection-privacy/grant-private-access.service";

const familyDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const grantBodySchema = z.object({
  parentId: m2UuidParamSchema,
  idempotencyKey: z.string().min(8).max(128),
});

type RouteContext = {
  params: Promise<{ studentId: string; familyDate: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { db, dbUser } = await requireStudentSessionForWrites();
    const { studentId, familyDate } = await context.params;
    m2UuidParamSchema.parse(studentId);
    familyDateSchema.parse(familyDate);

    if (dbUser.id !== studentId) {
      throw new ReflectionPrivacyError("FORBIDDEN", "Student access denied");
    }

    const [grants, parents] = await Promise.all([
      listReflectionGrants(db, { studentId, familyDate }),
      listActiveParentsForStudent(db, studentId),
    ]);

    return NextResponse.json({
      grants: grants.grants,
      eligibleParents: parents,
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { db, dbUser } = await requireStudentSessionForWrites();
    const { studentId, familyDate } = await context.params;
    m2UuidParamSchema.parse(studentId);
    familyDateSchema.parse(familyDate);

    if (dbUser.id !== studentId) {
      throw new ReflectionPrivacyError("FORBIDDEN", "Student access denied");
    }

    const body = grantBodySchema.parse(await request.json());
    const result = await grantPrivateAccess(db, {
      studentId,
      familyDate,
      parentId: body.parentId,
      idempotencyKey: body.idempotencyKey,
      requestId: request.headers.get("x-request-id") ?? undefined,
    });

    return NextResponse.json(result);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
