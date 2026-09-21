import { NextResponse } from "next/server";
import { z } from "zod";
import { m2UuidParamSchema } from "@/app/api/_lib/m2-schemas";
import { requireIdempotencyKey } from "@/app/api/_lib/require-idempotency-key";
import { toRouteErrorResponse } from "@/app/api/_lib/to-route-error-response";
import { requireTraineeSessionForWrites } from "@/lib/auth-request";
import { updateTaskExecution } from "@/modules/schedule/task-execution.service";

const bodySchema = z.object({ checklist: z.array(z.object({ id: z.string().min(1), title: z.string().trim().min(1), completed: z.boolean(), difficulty: z.string().trim().max(64).optional(), durationMinutes: z.number().int().positive().max(1440).optional() })).max(30).optional(), pomodoroAction: z.enum(["start", "pause", "resume"]).optional() }).strict();
export async function PATCH(request: Request, context: { params: Promise<{ itemId: string }> }) {
  const key = requireIdempotencyKey(request); if (!key.ok) return key.response;
  try { const { db, dbUser } = await requireTraineeSessionForWrites(); const { itemId } = await context.params; const result = await updateTaskExecution(db, { actorId: dbUser.id, actorRole: dbUser.role === "parent" ? "parent" : "student", scheduleItemId: m2UuidParamSchema.parse(itemId), idempotencyKey: key.key, ...bodySchema.parse(await request.json()), requestId: request.headers.get("x-request-id") ?? undefined }); return NextResponse.json(result); }
  catch (error) { const { status, body } = toRouteErrorResponse(error); return NextResponse.json(body, { status }); }
}
