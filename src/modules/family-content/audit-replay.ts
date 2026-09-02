import { eq } from "drizzle-orm";

import type { Database } from "@/db";
import { auditEvents } from "@/db/schema";
import { FamilyContentError } from "@/modules/family-content/errors";

export type AuditReplayLookup = {
  resourceId: string;
  payloadHash: string | null;
};

function readStoredPayloadHash(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") {
    return null;
  }
  const value = (metadata as { payloadHash?: unknown }).payloadHash;
  return typeof value === "string" ? value : null;
}

export async function findAuditReplay(
  db: Database,
  idempotencyKey: string,
): Promise<AuditReplayLookup | null> {
  const [row] = await db
    .select({ resourceId: auditEvents.resourceId, metadata: auditEvents.metadata })
    .from(auditEvents)
    .where(eq(auditEvents.idempotencyKey, idempotencyKey))
    .limit(1);
  if (!row?.resourceId) {
    return null;
  }
  return {
    resourceId: row.resourceId,
    payloadHash: readStoredPayloadHash(row.metadata),
  };
}

export function assertAuditReplayMatch(input: {
  replay: AuditReplayLookup;
  expectedResourceId: string;
  payloadHash: string;
  conflictMessage: string;
}): void {
  if (
    input.replay.resourceId !== input.expectedResourceId ||
    input.replay.payloadHash !== input.payloadHash
  ) {
    throw new FamilyContentError("IDEMPOTENCY_CONFLICT", input.conflictMessage);
  }
}
