import { NextResponse } from "next/server";

import { m2UuidParamSchema } from "@/app/api/_lib/m2-schemas";
import { toRouteErrorResponse } from "@/app/api/_lib/to-route-error-response";
import { requireAuthenticatedSession } from "@/lib/auth-request";
import { FamilyContentError } from "@/modules/family-content/errors";
import { issueMediaReadCapability } from "@/modules/family-content/media-capability.service";

type RouteContext = {
  params: Promise<{ studentId: string; referenceId: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { db, dbUser } = await requireAuthenticatedSession();
    if (dbUser.role !== "parent" && dbUser.role !== "student") {
      throw new FamilyContentError("FORBIDDEN", "Access denied");
    }

    const { studentId: rawStudentId, referenceId: rawReferenceId } = await context.params;
    const studentId = m2UuidParamSchema.parse(rawStudentId);
    const referenceId = m2UuidParamSchema.parse(rawReferenceId);
    void studentId;

    const issued = await issueMediaReadCapability(db, {
      actorId: dbUser.id,
      actorRole: dbUser.role,
      referenceId,
    });

    return NextResponse.json(issued);
  } catch (error) {
    const { status, body } = toRouteErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
