import { NextResponse } from "next/server";
import { z } from "zod";

import { toRouteErrorResponse } from "@/app/api/_lib/to-route-error-response";
import { requireAuthenticatedSession } from "@/lib/auth-request";
import { FamilyContentError } from "@/modules/family-content/errors";
import { readMediaWithCapability } from "@/modules/family-content/media-capability.service";
import { getRouteMediaStore } from "@/modules/family-content/route-media-stores";

const bodySchema = z.object({
  capabilityToken: z.string().min(16).max(256),
});

export async function POST(request: Request) {
  try {
    const { db, dbUser } = await requireAuthenticatedSession();
    if (dbUser.role !== "parent" && dbUser.role !== "student") {
      throw new FamilyContentError("FORBIDDEN", "Access denied");
    }

    const parsed = bodySchema.parse(await request.json());
    const result = await readMediaWithCapability(db, {
      capabilityToken: parsed.capabilityToken,
      mediaStore: getRouteMediaStore(),
    });

    return new NextResponse(new Uint8Array(result.bytes), {
      status: 200,
      headers: {
        "Content-Type": result.mime,
        "Cache-Control": "no-store",
        "X-Media-Id": result.mediaId,
      },
    });
  } catch (error) {
    const { status, body } = toRouteErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
