import { NextResponse } from "next/server";

import { m2UuidParamSchema } from "@/app/api/_lib/m2-schemas";
import { requireIdempotencyKey } from "@/app/api/_lib/require-idempotency-key";
import { toRouteErrorResponse } from "@/app/api/_lib/to-route-error-response";
import { requireAuthenticatedSession } from "@/lib/auth-request";
import {
  getExportJobStatusForActor,
  processExportJob,
} from "@/modules/data-lifecycle/export-job.service";

import { exportRouteArtifactStore } from "@/modules/data-lifecycle/route-artifact-stores";

type RouteContext = {
  params: Promise<{ jobId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const idempotency = requireIdempotencyKey(request);
  if (!idempotency.ok) {
    return idempotency.response;
  }

  try {
    const { db, dbUser } = await requireAuthenticatedSession();
    const { jobId: rawJobId } = await context.params;
    const jobId = m2UuidParamSchema.parse(rawJobId);

    await getExportJobStatusForActor(db, jobId, {
      actorId: dbUser.id,
      actorRole: dbUser.role as "student" | "parent" | "admin",
    });

    const result = await processExportJob(db, {
      jobId,
      artifactStore: exportRouteArtifactStore,
    });

    return NextResponse.json(result);
  } catch (error) {
    const { status, body } = toRouteErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
