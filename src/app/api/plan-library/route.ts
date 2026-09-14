import { NextResponse } from "next/server";
import { z } from "zod";
import { requireIdempotencyKey } from "@/app/api/_lib/require-idempotency-key";
import { toRouteErrorResponse } from "@/app/api/_lib/to-route-error-response";
import { requireTraineeSession, requireTraineeSessionForWrites } from "@/lib/auth-request";
import {
  createPlanLibrary,
  listPlanLibrary,
  listStudentPlanLibrary,
  updatePlanLibrary,
} from "@/modules/schedule/plan-library.service";
function errorResponse(error: unknown) {
  if (typeof error === "object" && error !== null && "code" in error && error.code === "42P01")
    return NextResponse.json(
      {
        error: {
          code: "PLAN_LIBRARY_UNAVAILABLE",
          message: "计划库尚未迁移到当前数据库，请先完成本机数据库迁移。",
        },
      },
      { status: 503 },
    );
  const { status, body } = toRouteErrorResponse(error);
  return NextResponse.json(body, { status });
}
export async function GET() {
  try {
    const { db, dbUser } = await requireTraineeSession();
    return NextResponse.json({
      plans:
        dbUser.role === "student"
          ? await listStudentPlanLibrary(db, dbUser.id)
          : await listPlanLibrary(db, dbUser.id),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(request: Request) {
  const key = requireIdempotencyKey(request);
  if (!key.ok) return key.response;
  try {
    const { db, dbUser } = await requireTraineeSessionForWrites();
    const body = z.object({ definition: z.unknown(), priority: z.number().int().min(0).max(100).optional() }).parse(await request.json());
    return NextResponse.json({
      plan: await createPlanLibrary(db, {
        ownerId: dbUser.id,
        definition: body.definition,
        priority: body.priority,
        idempotencyKey: key.key,
      }),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
export async function PATCH(request: Request) {
  const key = requireIdempotencyKey(request);
  if (!key.ok) return key.response;
  try {
    const { db, dbUser } = await requireTraineeSessionForWrites();
    const body = z
      .object({
        libraryId: z.string().uuid(),
        revision: z.number().int().positive(),
        definition: z.object({}).passthrough(),
        priority: z.number().int().min(0).max(100).optional(),
      })
      .parse(await request.json());
    return NextResponse.json({
      plan: await updatePlanLibrary(db, { ownerId: dbUser.id, ...body, idempotencyKey: key.key }),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
