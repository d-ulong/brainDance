import { NextResponse } from "next/server";

import { toRouteErrorResponse } from "@/app/api/_lib/to-route-error-response";
import { requireAuthenticatedSession } from "@/lib/auth-request";
import { listNotificationsForUser } from "@/modules/notification/notification.service";
import { FamilyContentError } from "@/modules/family-content/errors";

export async function GET() {
  try {
    const { db, dbUser } = await requireAuthenticatedSession();
    if (dbUser.role !== "parent" && dbUser.role !== "student") {
      throw new FamilyContentError("FORBIDDEN", "Access denied");
    }
    const items = await listNotificationsForUser(db, { userId: dbUser.id });
    return NextResponse.json({ notifications: items });
  } catch (error) {
    const { status, body } = toRouteErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
