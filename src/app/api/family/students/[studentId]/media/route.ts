import { NextResponse } from "next/server";
import { z } from "zod";

import { m2UuidParamSchema } from "@/app/api/_lib/m2-schemas";
import { requireIdempotencyKey } from "@/app/api/_lib/require-idempotency-key";
import { toRouteErrorResponse } from "@/app/api/_lib/to-route-error-response";
import { requireAuthenticatedSession } from "@/lib/auth-request";
import { FamilyContentError } from "@/modules/family-content/errors";
import { uploadFamilyMedia } from "@/modules/family-content/media-upload.service";
import {
  getRouteMediaScanner,
  getRouteMediaStore,
  getRouteMediaUploadIdempotencyLock,
} from "@/modules/family-content/route-media-stores";
import { ALLOWED_MIMES, MAX_MEDIA_BYTES } from "@/modules/family-content/constants";

const declaredMimeSchema = z.enum(ALLOWED_MIMES);

/** Multipart framing overhead above the raw 10 MiB file budget. */
const MULTIPART_OVERHEAD_BYTES = 256 * 1024;

type RouteContext = {
  params: Promise<{ studentId: string }>;
};

/**
 * Enforce request body size before Next.js materializes the full multipart payload.
 * Content-Length is required so chunked unbounded uploads cannot bypass the limit.
 * Rejection responses must not echo filename, bytes, or tokens.
 */
function assertRequestBodyWithinLimit(request: Request): void {
  const raw = request.headers.get("content-length");
  if (raw == null || raw.trim() === "") {
    throw new FamilyContentError("VALIDATION_ERROR", "Content-Length required");
  }
  const length = Number(raw);
  if (!Number.isFinite(length) || length < 0 || !Number.isInteger(length)) {
    throw new FamilyContentError("VALIDATION_ERROR", "Invalid Content-Length");
  }
  if (length > MAX_MEDIA_BYTES + MULTIPART_OVERHEAD_BYTES) {
    throw new FamilyContentError("VALIDATION_ERROR", "Media exceeds 10 MiB limit");
  }
}

export async function POST(request: Request, context: RouteContext) {
  const idempotency = requireIdempotencyKey(request);
  if (!idempotency.ok) {
    return idempotency.response;
  }

  try {
    const { db, dbUser } = await requireAuthenticatedSession();
    if (dbUser.role !== "parent" && dbUser.role !== "student") {
      throw new FamilyContentError("FORBIDDEN", "Access denied");
    }

    const { studentId: rawStudentId } = await context.params;
    const studentId = m2UuidParamSchema.parse(rawStudentId);

    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.includes("multipart/form-data")) {
      throw new FamilyContentError("VALIDATION_ERROR", "Expected multipart upload");
    }

    assertRequestBodyWithinLimit(request);

    const form = await request.formData();
    const file = form.get("file");
    const declaredRaw = form.get("declaredMime");
    if (!(file instanceof File)) {
      throw new FamilyContentError("VALIDATION_ERROR", "file is required");
    }
    if (typeof declaredRaw !== "string") {
      throw new FamilyContentError("VALIDATION_ERROR", "declaredMime is required");
    }
    const declaredMime = declaredMimeSchema.parse(declaredRaw.trim().toLowerCase());

    // Defense in depth after early Content-Length gate.
    if (file.size > MAX_MEDIA_BYTES) {
      throw new FamilyContentError("VALIDATION_ERROR", "Media exceeds 10 MiB limit");
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const result = await uploadFamilyMedia(db, {
      actorId: dbUser.id,
      studentId,
      declaredMime,
      bytes,
      idempotencyKey: idempotency.key,
      requestId: request.headers.get("x-request-id") ?? undefined,
      mediaStore: getRouteMediaStore(),
      scanner: getRouteMediaScanner(),
      idempotencyLock: getRouteMediaUploadIdempotencyLock(),
    });

    return NextResponse.json({
      ...result.media,
      idempotentReplay: result.idempotentReplay,
    });
  } catch (error) {
    const { status, body } = toRouteErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
