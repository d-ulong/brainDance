import { NextResponse } from "next/server";

import { m2UuidParamSchema } from "@/app/api/_lib/m2-schemas";
import { deliverExportDownloadBodySchema } from "@/app/api/_lib/m6-lifecycle-schemas";
import { toRouteErrorResponse } from "@/app/api/_lib/to-route-error-response";
import { requireAuthenticatedSession } from "@/lib/auth-request";
import {
  getExportJobStatusForActor,
  deliverExportDownload,
} from "@/modules/data-lifecycle/export-job.service";
import { exportRouteArtifactStore } from "@/modules/data-lifecycle/route-artifact-stores";

type RouteContext = {
  params: Promise<{ jobId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { db, dbUser } = await requireAuthenticatedSession();
    const { jobId: rawJobId } = await context.params;
    const jobId = m2UuidParamSchema.parse(rawJobId);

    const job = await getExportJobStatusForActor(
      db,
      jobId,
      {
        actorId: dbUser.id,
        actorRole: dbUser.role as "student" | "parent" | "admin",
      },
      { artifactStore: exportRouteArtifactStore },
    );

    return NextResponse.json({
      id: job.id,
      status: job.status,
      readyAt: job.readyAt,
      expiresAt: job.expiresAt,
      consumedAt: job.consumedAt,
      downloadTokenPlaintext: job.downloadTokenPlaintext,
    });
  } catch (error) {
    const { status, body } = toRouteErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { db, dbUser } = await requireAuthenticatedSession();
    const { jobId: rawJobId } = await context.params;
    const jobId = m2UuidParamSchema.parse(rawJobId);
    const body = deliverExportDownloadBodySchema.parse(await request.json());

    const result = await deliverExportDownload(db, {
      jobId,
      tokenPlaintext: body.token,
      artifactStore: exportRouteArtifactStore,
      actor: {
        actorId: dbUser.id,
        actorRole: dbUser.role as "student" | "parent" | "admin",
      },
    });

    return new NextResponse(new Uint8Array(result.content), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    const { status, body } = toRouteErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
