import { eq } from "drizzle-orm";

import type { Database } from "@/db";
import { auditEvents } from "@/db/schema";
import type { AuditMetadata } from "@/modules/identity/constants";

export type AppendAuditInput = {
  actorId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  reasonCode?: string | null;
  requestId?: string | null;
  idempotencyKey?: string | null;
  metadata?: AuditMetadata;
};

export async function appendAuditEvent(db: Database, input: AppendAuditInput): Promise<string> {
  if (input.idempotencyKey) {
    const existing = await db.query.auditEvents.findFirst({
      where: eq(auditEvents.idempotencyKey, input.idempotencyKey),
    });
    if (existing) {
      return existing.id;
    }
  }

  const sanitizedMetadata = sanitizeAuditMetadata(input.metadata);

  const [row] = await db
    .insert(auditEvents)
    .values({
      actorId: input.actorId ?? null,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      reasonCode: input.reasonCode ?? null,
      requestId: input.requestId ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      metadata: sanitizedMetadata,
    })
    .onConflictDoNothing({ target: auditEvents.idempotencyKey })
    .returning({ id: auditEvents.id });

  if (row) {
    return row.id;
  }

  if (input.idempotencyKey) {
    const existing = await db.query.auditEvents.findFirst({
      where: eq(auditEvents.idempotencyKey, input.idempotencyKey),
    });
    if (existing) {
      return existing.id;
    }
  }

  throw new Error("Failed to append audit event");
}

function sanitizeAuditMetadata(metadata?: AuditMetadata): AuditMetadata | null {
  if (!metadata) {
    return null;
  }

  const forbiddenKeys = ["code", "password", "invite", "invitation", "otp", "token", "secret"];
  const result: AuditMetadata = {};

  for (const [key, value] of Object.entries(metadata)) {
    const lower = key.toLowerCase();
    if (forbiddenKeys.some((part) => lower.includes(part))) {
      continue;
    }
    if (typeof value === "string" && value.length > 256) {
      result[key] = `${value.slice(0, 253)}...`;
      continue;
    }
    result[key] = value;
  }

  return Object.keys(result).length > 0 ? result : null;
}
