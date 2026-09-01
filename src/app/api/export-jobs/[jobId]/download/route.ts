import { NextResponse } from "next/server";

import { m2UuidParamSchema } from "@/app/api/_lib/m2-schemas";
import { deliverExportDownloadBodySchema } from "@/app/api/_lib/m6-lifecycle-schemas";
import { toRouteErrorResponse } from "@/app/api/_lib/to-route-error-response";
import { requireAuthenticatedSession } from "@/lib/auth-request";
import {
  getExportJobStatusForActor,
  deliverExportDownload,
} from "@/modules/data-lifecycle/export-job.service";
import { createMemoryArtifactStore } from "@/modules/data-lifecycle/private-artifact-store";

type RouteContext = {
  params: Promise<{ jobId: string }>;
};

const artifactStore = createMemoryArtifactStore();

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { db, dbUser } = await requireAuthenticatedSession();
    const { jobId: rawJobId } = await context.params;
    const jobId = m2UuidParamSchema.parse(rawJobId);

    const job = await getExportJobStatusForActor(db, jobId, {
      actorId: dbUser.id,
      actorRole: dbUser.role as "student" | "parent" | "admin",
    });

    return NextResponse.json({
      id: job.id,
      status: job.status,
      readyAt: job.readyAt,
      expiresAt: job.expiresAt,
      consumedAt: job.consumedAt,
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
      artifactStore,
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

export { artifactStore as exportRouteArtifactStore };
