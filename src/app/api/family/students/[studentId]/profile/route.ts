import { NextResponse } from "next/server";

import { requireParentSession } from "@/lib/auth-request";
import { toErrorResponse } from "@/lib/http-errors";
import { getStudentProfileForParent } from "@/modules/family-access/relationship-request.service";

type RouteContext = {
  params: Promise<{ studentId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { db, dbUser } = await requireParentSession();
    const { studentId } = await context.params;

    const profile = await getStudentProfileForParent(db, dbUser.id, studentId);

    return NextResponse.json(profile);
  } catch (error) {
    const { status, body } = toErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
