import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { relationshipRequests } from "@/db/schema";
import { requireParentSession, requireStudentSession } from "@/lib/auth-request";
import { toErrorResponse } from "@/lib/http-errors";
import { createRelationshipRequest } from "@/modules/family-access/relationship-request.service";

const bodySchema = z.object({
  associationCode: z.string().min(8).max(128),
  idempotencyKey: z.string().min(8).max(128),
});

export async function GET() {
  try {
    const { db, dbUser } = await requireStudentSession();

    const rows = await db
      .select({
        requestId: relationshipRequests.id,
        parentId: relationshipRequests.parentId,
        status: relationshipRequests.status,
        expiresAt: relationshipRequests.expiresAt,
        createdAt: relationshipRequests.createdAt,
      })
      .from(relationshipRequests)
      .where(
        and(
          eq(relationshipRequests.studentId, dbUser.id),
          eq(relationshipRequests.status, "pending"),
        ),
      );

    return NextResponse.json({
      requests: rows.map((row) => ({
        requestId: row.requestId,
        parentId: row.parentId,
        status: row.status,
        expiresAt: row.expiresAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function POST(request: Request) {
  try {
    const { db, dbUser } = await requireParentSession();
    const body = bodySchema.parse(await request.json());

    const result = await createRelationshipRequest(db, {
      parentId: dbUser.id,
      associationCodePlaintext: body.associationCode,
      idempotencyKey: body.idempotencyKey,
      requestId: request.headers.get("x-request-id") ?? undefined,
    });

    return NextResponse.json({
      requestId: result.requestId,
      studentId: result.studentId,
      status: result.status,
      expiresAt: result.expiresAt.toISOString(),
      idempotentReplay: result.idempotentReplay,
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
