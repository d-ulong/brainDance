import { NextResponse } from "next/server";
import { z } from "zod";
import { requireIdempotencyKey } from "@/app/api/_lib/require-idempotency-key";
import { toRouteErrorResponse } from "@/app/api/_lib/to-route-error-response";
import { requireTraineeSessionForWrites } from "@/lib/auth-request";
import { activatePlanLibrary } from "@/modules/schedule/plan-library.service";
export async function POST(request: Request, context: {params: Promise<{libraryId:string}>}) { const key=requireIdempotencyKey(request); if(!key.ok) return key.response; try { const {db,dbUser}=await requireTraineeSessionForWrites(); const {libraryId}=await context.params; const body=z.object({studentId:z.string().uuid().optional(),effectiveFrom:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()}).parse(await request.json()); const studentId=dbUser.role === "student" ? dbUser.id : z.string().uuid().parse(body.studentId); return NextResponse.json(await activatePlanLibrary(db,{ownerId:dbUser.id,libraryId,studentId,effectiveFrom:body.effectiveFrom,idempotencyKey:key.key})); } catch(error) {const {status,body}=toRouteErrorResponse(error);return NextResponse.json(body,{status});}}
