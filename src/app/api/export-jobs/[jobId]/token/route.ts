import { NextResponse } from "next/server";

import { m2UuidParamSchema } from "@/app/api/_lib/m2-schemas";
import { requireIdempotencyKey } from "@/app/api/_lib/require-idempotency-key";
import { toRouteErrorResponse } from "@/app/api/_lib/to-route-error-response";
import { requireAuthenticatedSession } from "@/lib/auth-request";
import { issueExportDownloadToken } from "@/modules/data-lifecycle/export-job.service";

type RouteContext = {
  params: Promise<{ jobId: string }>;
};

/**
 * Authorization-gated download-token issuance (F01).
 *
 * Only the authenticated requester (or admin) may obtain a token, and only while
 * the job is READY with the artifact present and the student is not frozen. The
 * plaintext token is returned once and never persisted; the stored hash rotates
 * on each issuance so a failed/lost response can be retried safely.
 */
export async function POST(request: Request, context: RouteContext) {
  const idempotency = requireIdempotencyKey(request);
  if (!idempotency.ok) {
    return idempotency.response;
  }

  try {
    const { db, dbUser } = await requireAuthenticatedSession();
    const { jobId: rawJobId } = await context.params;
    const jobId = m2UuidParamSchema.parse(rawJobId);

    const result = await issueExportDownloadToken(db, {
      jobId,
      actor: {
        actorId: dbUser.id,
        actorRole: dbUser.role as "student" | "parent" | "admin",
      },
    });

    return NextResponse.json({
      token: result.token,
      expiresAt: result.expiresAt,
    });
  } catch (error) {
    const { status, body } = toRouteErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
