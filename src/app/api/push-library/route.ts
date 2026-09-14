import { NextResponse } from "next/server";
import { z } from "zod";

import { requireIdempotencyKey } from "@/app/api/_lib/require-idempotency-key";
import { toRouteErrorResponse } from "@/app/api/_lib/to-route-error-response";
import { requireParentSession, requireVerifiedParentSession } from "@/lib/auth-request";
import { listPushLibrary, publishPushLibraryEntry, savePushLibraryEntry } from "@/modules/family-content/push-library.service";
import { MAX_PUSH_IMAGES } from "@/modules/family-content/constants";

const tagSchema = z.string().trim().min(1).max(40);
const contentSchema = z.object({
  entryId: z.string().uuid().optional(), revision: z.number().int().positive().optional(),
  body: z.string().max(10_000).optional().nullable(), linkUrl: z.string().url().max(2048).optional().nullable(),
  tags: z.array(tagSchema).max(20).optional(),
  answerDisclosureDays: z.number().int().min(0).max(365).nullable().optional(),
});
const publishSchema = z.object({
  entryId: z.string().uuid(), revision: z.number().int().positive(), studentIds: z.array(z.string().uuid()).min(1).max(100),
  publishMode: z.enum(["immediate", "scheduled"]), scheduledPublishAt: z.string().datetime().optional(),
  mediaIdsByStudent: z.record(z.string().uuid(), z.array(z.string().uuid()).max(MAX_PUSH_IMAGES)).optional(),
});

export async function GET(request: Request) {
  try {
    const { db, dbUser } = await requireParentSession();
    const url = new URL(request.url);
    const tags = url.searchParams.getAll("tag").filter(Boolean);
    const result = await listPushLibrary(db, { actorId: dbUser.id, studentId: url.searchParams.get("studentId") ?? undefined,
      from: url.searchParams.get("from") ?? undefined, through: url.searchParams.get("through") ?? undefined, tags: tags.length ? tags : undefined });
    return NextResponse.json(result);
  } catch (error) { const { status, body } = toRouteErrorResponse(error); return NextResponse.json(body, { status }); }
}

export async function POST(request: Request) {
  const idempotency = requireIdempotencyKey(request); if (!idempotency.ok) return idempotency.response;
  try {
    const { db, dbUser } = await requireVerifiedParentSession();
    const body = contentSchema.parse(await request.json());
    const entry = await savePushLibraryEntry(db, { ...body, actorId: dbUser.id, idempotencyKey: idempotency.key });
    return NextResponse.json({ entry });
  } catch (error) { const { status, body } = toRouteErrorResponse(error); return NextResponse.json(body, { status }); }
}

export async function PATCH(request: Request) {
  const idempotency = requireIdempotencyKey(request); if (!idempotency.ok) return idempotency.response;
  try {
    const { db, dbUser } = await requireVerifiedParentSession();
    const body = publishSchema.parse(await request.json());
    const result = await publishPushLibraryEntry(db, { ...body, actorId: dbUser.id, idempotencyKey: idempotency.key });
    return NextResponse.json(result);
  } catch (error) { const { status, body } = toRouteErrorResponse(error); return NextResponse.json(body, { status }); }
}
