import { NextResponse } from "next/server";
import { z } from "zod";

import { requireParentSession, requireVerifiedParentSession } from "@/lib/auth-request";
import { toErrorResponse } from "@/lib/http-errors";
import { listLinkedStudentsForParent } from "@/modules/family-access/linked-students.service";
import { createControlledStudent } from "@/modules/identity/create-controlled-student.service";
import { PRODUCT_PASSWORD_MAX_LENGTH } from "@/modules/identity/password-policy";

const bodySchema = z.object({
  username: z.string().min(3).max(64),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  displayName: z.string().min(1).max(128).optional(),
  initialPassword: z.string().min(1).max(PRODUCT_PASSWORD_MAX_LENGTH),
  idempotencyKey: z.string().min(8).max(128),
});

export async function GET() {
  try {
    const { db, dbUser } = await requireParentSession();

    const students = await listLinkedStudentsForParent(db, dbUser.id);
    return NextResponse.json({ students });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function POST(request: Request) {
  try {
    const { db, dbUser } = await requireVerifiedParentSession();
    const body = bodySchema.parse(await request.json());

    const result = await createControlledStudent(db, {
      parentId: dbUser.id,
      username: body.username,
      birthDate: body.birthDate,
      displayName: body.displayName,
      initialPassword: body.initialPassword,
      idempotencyKey: body.idempotencyKey,
      requestId: request.headers.get("x-request-id") ?? undefined,
    });

    return NextResponse.json(result);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
