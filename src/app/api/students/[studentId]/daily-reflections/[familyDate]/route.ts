import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAuthenticatedSession, requireStudentSessionForWrites } from "@/lib/auth-request";
import { toErrorResponse } from "@/lib/http-errors";
import { m2UuidParamSchema } from "@/app/api/_lib/m2-schemas";
import { deleteDailyReflection } from "@/modules/reflection-privacy/delete-daily-reflection.service";
import { ReflectionPrivacyError } from "@/modules/reflection-privacy/errors";
import { getDailyReflection } from "@/modules/reflection-privacy/get-daily-reflection.service";
import { upsertDailyReflection } from "@/modules/reflection-privacy/upsert-daily-reflection.service";

const familyDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const upsertBodySchema = z.object({
  body: z.string(),
  visibility: z.enum(["normal", "private"]),
  idempotencyKey: z.string().min(8).max(128),
});

const deleteBodySchema = z.object({
  idempotencyKey: z.string().min(8).max(128),
});

type RouteContext = {
  params: Promise<{ studentId: string; familyDate: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { db, dbUser } = await requireAuthenticatedSession();
    const { studentId, familyDate } = await context.params;
    m2UuidParamSchema.parse(studentId);
    familyDateSchema.parse(familyDate);

    if (dbUser.role !== "student" && dbUser.role !== "parent") {
      throw new ReflectionPrivacyError("FORBIDDEN", "Access denied");
    }

    const reflection = await getDailyReflection(db, {
      actorId: dbUser.id,
      actorRole: dbUser.role === "student" ? "student" : "parent",
      studentId,
      familyDate,
    });

    return NextResponse.json(reflection);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function PUT(request: Request, context: RouteContext) {
  try {
    const { db, dbUser } = await requireStudentSessionForWrites();
    const { studentId, familyDate } = await context.params;
    m2UuidParamSchema.parse(studentId);
    familyDateSchema.parse(familyDate);

    if (dbUser.id !== studentId) {
      throw new ReflectionPrivacyError("FORBIDDEN", "Student access denied");
    }

    const body = upsertBodySchema.parse(await request.json());
    const result = await upsertDailyReflection(db, {
      studentId,
      familyDate,
      body: body.body,
      visibility: body.visibility,
      idempotencyKey: body.idempotencyKey,
      requestId: request.headers.get("x-request-id") ?? undefined,
    });

    return NextResponse.json({
      ...result.reflection,
      idempotentReplay: result.idempotentReplay,
    });
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const { db, dbUser } = await requireStudentSessionForWrites();
    const { studentId, familyDate } = await context.params;
    m2UuidParamSchema.parse(studentId);
    familyDateSchema.parse(familyDate);

    if (dbUser.id !== studentId) {
      throw new ReflectionPrivacyError("FORBIDDEN", "Student access denied");
    }

    const body = deleteBodySchema.parse(await request.json());
    const result = await deleteDailyReflection(db, {
      studentId,
      familyDate,
      idempotencyKey: body.idempotencyKey,
      requestId: request.headers.get("x-request-id") ?? undefined,
    });

    return NextResponse.json(result);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
