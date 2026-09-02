import { NextResponse } from "next/server";

import { toRouteErrorResponse } from "@/app/api/_lib/to-route-error-response";
import { requireStudentSession } from "@/lib/auth-request";
import { listFamilyPushes } from "@/modules/family-content/push-lifecycle.service";

export async function GET() {
  try {
    const { db, dbUser } = await requireStudentSession();
    const pushes = await listFamilyPushes(db, {
      actorId: dbUser.id,
      actorRole: "student",
      studentId: dbUser.id,
    });
    return NextResponse.json({ pushes });
  } catch (error) {
    const { status, body } = toRouteErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
