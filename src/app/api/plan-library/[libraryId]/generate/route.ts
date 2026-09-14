import { NextResponse } from "next/server";
import { z } from "zod";

import { requireIdempotencyKey } from "@/app/api/_lib/require-idempotency-key";
import { toRouteErrorResponse } from "@/app/api/_lib/to-route-error-response";
import { requireTraineeSessionForWrites } from "@/lib/auth-request";
import { generatePlanLibraryRange } from "@/modules/schedule/plan-library.service";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export async function POST(request: Request, context: { params: Promise<{ libraryId: string }> }) {
  const key = requireIdempotencyKey(request); if (!key.ok) return key.response;
  try {
    const { db, dbUser } = await requireTraineeSessionForWrites(); const { libraryId } = await context.params;
    const body = z.object({ studentId: z.string().uuid().optional(), from: date, through: date }).parse(await request.json());
    const studentId = dbUser.role === "student" ? dbUser.id : z.string().uuid().parse(body.studentId);
    return NextResponse.json(await generatePlanLibraryRange(db, { ownerId: dbUser.id, libraryId, studentId, from: body.from, through: body.through, idempotencyKey: key.key }));
  } catch (error) { const { status, body } = toRouteErrorResponse(error); return NextResponse.json(body, { status }); }
}
