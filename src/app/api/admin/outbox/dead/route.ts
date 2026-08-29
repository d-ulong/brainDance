import { NextResponse } from "next/server";

import { deadOutboxQuerySchema } from "@/app/api/_lib/m2-schemas";
import { toRouteErrorResponse } from "@/app/api/_lib/to-route-error-response";
import { requireAdminSession } from "@/lib/auth-request";
import { listDeadOutboxEvents } from "@/modules/outbox/replay-outbox-event.service";

export async function GET(request: Request) {
  try {
    const { db } = await requireAdminSession();
    const url = new URL(request.url);
    const query = deadOutboxQuerySchema.parse({
      limit: url.searchParams.get("limit") ?? undefined,
      offset: url.searchParams.get("offset") ?? undefined,
    });

    const result = await listDeadOutboxEvents(db, query);
    return NextResponse.json(result);
  } catch (error) {
    const { status, body } = toRouteErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
