import { and, eq } from "drizzle-orm";

import type { Database } from "@/db";
import { pointRedemptions, redemptionCatalogItems } from "@/db/schema";
import { appendAuditEvent } from "@/modules/audit/append-audit-event";
import { appendOutboxEvent } from "@/modules/outbox/append-outbox-event";

export async function deactivateCreatorRedemptionOnRelationshipEnd(
  tx: Database,
  input: {
    parentId: string;
    studentId: string;
    endedAt: Date;
    relationshipEndIdempotencyKey: string;
    actorId: string;
    requestId?: string;
  },
): Promise<void> {
  const activeCatalogItems = await tx
    .select()
    .from(redemptionCatalogItems)
    .where(
      and(
        eq(redemptionCatalogItems.creatorParentId, input.parentId),
        eq(redemptionCatalogItems.studentId, input.studentId),
        eq(redemptionCatalogItems.active, true),
      ),
    );

  for (const catalogItem of activeCatalogItems) {
    const deactivateKey = `rel-end:${input.relationshipEndIdempotencyKey}:catalog:${catalogItem.id}`;

    await tx
      .update(redemptionCatalogItems)
      .set({ active: false, updatedAt: input.endedAt })
      .where(
        and(eq(redemptionCatalogItems.id, catalogItem.id), eq(redemptionCatalogItems.active, true)),
      );

    await appendAuditEvent(tx, {
      actorId: input.actorId,
      action: "redemption_catalog.deactivated",
      resourceType: "redemption_catalog_item",
      resourceId: catalogItem.id,
      requestId: input.requestId ?? null,
      idempotencyKey: `audit:rel-end-catalog-deactivated:${deactivateKey}`,
      metadata: {
        studentId: catalogItem.studentId,
        reason: "relationship_ended",
        creatorParentId: input.parentId,
      },
    });

    await appendOutboxEvent(tx, {
      aggregateType: "redemption_catalog_item",
      aggregateId: catalogItem.id,
      eventType: "redemption_catalog.deactivated",
      dedupeKey: `redemption_catalog.deactivated:rel-end:${deactivateKey}`,
      payload: {
        schemaVersion: 1,
        catalogItemId: catalogItem.id,
        studentId: catalogItem.studentId,
        reason: "relationship_ended",
      },
    });
  }

  const pendingRedemptions = await tx
    .select()
    .from(pointRedemptions)
    .where(
      and(eq(pointRedemptions.studentId, input.studentId), eq(pointRedemptions.status, "pending")),
    );

  for (const redemption of pendingRedemptions) {
    const [catalogItem] = await tx
      .select({ creatorParentId: redemptionCatalogItems.creatorParentId })
      .from(redemptionCatalogItems)
      .where(eq(redemptionCatalogItems.id, redemption.catalogItemId))
      .limit(1);

    if (catalogItem?.creatorParentId !== input.parentId) {
      continue;
    }

    const cancelKey = `rel-end:${input.relationshipEndIdempotencyKey}:redemption:${redemption.id}`;

    const [updated] = await tx
      .update(pointRedemptions)
      .set({
        status: "cancelled",
        confirmedAt: input.endedAt,
        confirmedBy: input.actorId,
      })
      .where(and(eq(pointRedemptions.id, redemption.id), eq(pointRedemptions.status, "pending")))
      .returning({ id: pointRedemptions.id });

    if (!updated) {
      continue;
    }

    await appendAuditEvent(tx, {
      actorId: input.actorId,
      action: "point_redemption.cancelled",
      resourceType: "point_redemption",
      resourceId: redemption.id,
      requestId: input.requestId ?? null,
      idempotencyKey: `audit:rel-end-redemption-cancelled:${cancelKey}`,
      metadata: {
        studentId: input.studentId,
        reason: "relationship_ended",
        creatorParentId: input.parentId,
      },
    });

    await appendOutboxEvent(tx, {
      aggregateType: "point_redemption",
      aggregateId: redemption.id,
      eventType: "point_redemption.cancelled",
      dedupeKey: `point_redemption.cancelled:rel-end:${cancelKey}`,
      payload: {
        schemaVersion: 1,
        redemptionId: redemption.id,
        reason: "relationship_ended",
      },
    });
  }
}
