import { NextResponse } from "next/server";
import { z } from "zod";

import { requireStudentSessionForWrites } from "@/lib/auth-request";
import { toErrorResponse } from "@/lib/http-errors";
import { issueAssociationCode } from "@/modules/family-access/association-code.service";

const bodySchema = z.object({
  idempotencyKey: z.string().min(8).max(128),
});

export async function POST(request: Request) {
  try {
    const { db, dbUser } = await requireStudentSessionForWrites();
    const body = bodySchema.parse(await request.json());

    const result = await issueAssociationCode(db, {
      studentId: dbUser.id,
      idempotencyKey: body.idempotencyKey,
      requestId: request.headers.get("x-request-id") ?? undefined,
    });

    return NextResponse.json({
      associationCodeId: result.associationCodeId,
      expiresAt: result.expiresAt.toISOString(),
      idempotentReplay: result.idempotentReplay,
      code: result.idempotentReplay ? undefined : result.codePlaintext,
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
