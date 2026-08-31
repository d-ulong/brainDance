import { and, eq, sql } from "drizzle-orm";

import type { Database } from "@/db";
import { plans, pointRedemptions, pointRules, redemptionCatalogItems } from "@/db/schema";
import { appendAuditEvent } from "@/modules/audit/append-audit-event";
import { appendOutboxEvent } from "@/modules/outbox/append-outbox-event";
import { persistExpiredPastWindow } from "@/modules/schedule/persist-expired.service";
import { toFamilyDate } from "@/modules/time-policy/to-family-date";

export async function deactivateCreatorConfigsOnRelationshipEnd(
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
  const today = toFamilyDate(input.endedAt);

  const activePlans = await tx
    .select()
    .from(plans)
    .where(
      and(
        eq(plans.ownerId, input.parentId),
        eq(plans.studentId, input.studentId),
        eq(plans.status, "active"),
        eq(plans.planKind, "formal"),
      ),
    );

  for (const plan of activePlans) {
    const deactivateKey = `rel-end:${input.relationshipEndIdempotencyKey}:plan:${plan.id}`;

    await tx
      .update(plans)
      .set({
        status: "inactive",
        deactivateIdempotencyKey: deactivateKey,
        deactivateIdempotencyPayloadHash: "relationship-end",
      })
      .where(and(eq(plans.id, plan.id), eq(plans.status, "active")));

    await tx.execute(sql`
      UPDATE schedule_items
      SET status = 'cancelled'
      WHERE plan_id = ${plan.id}::uuid
        AND status = 'pending'
        AND family_date >= ${today}::date
    `);

    await persistExpiredPastWindow(tx, plan.studentId, input.endedAt);

    await appendAuditEvent(tx, {
      actorId: input.actorId,
      action: "formal_plan.deactivated",
      resourceType: "plan",
      resourceId: plan.id,
      requestId: input.requestId ?? null,
      idempotencyKey: `audit:rel-end-plan-deactivated:${deactivateKey}`,
      metadata: {
        studentId: plan.studentId,
        reason: "relationship_ended",
        ownerId: input.parentId,
      },
    });

    await appendOutboxEvent(tx, {
      aggregateType: "plan",
      aggregateId: plan.id,
      eventType: "plan.deactivated",
      dedupeKey: `plan.deactivated:rel-end:${deactivateKey}`,
      payload: {
        planId: plan.id,
        studentId: plan.studentId,
        reason: "relationship_ended",
      },
    });
  }

  const activeRules = await tx
    .select()
    .from(pointRules)
    .where(
      and(
        eq(pointRules.creatorParentId, input.parentId),
        eq(pointRules.studentId, input.studentId),
        eq(pointRules.active, true),
      ),
    );

  for (const rule of activeRules) {
    const deactivateKey = `rel-end:${input.relationshipEndIdempotencyKey}:rule:${rule.id}`;

    await tx
      .update(pointRules)
      .set({ active: false })
      .where(and(eq(pointRules.id, rule.id), eq(pointRules.active, true)));

    await appendAuditEvent(tx, {
      actorId: input.actorId,
      action: "point_rule.deactivated",
      resourceType: "point_rule",
      resourceId: rule.id,
      requestId: input.requestId ?? null,
      idempotencyKey: `audit:rel-end-rule-deactivated:${deactivateKey}`,
      metadata: {
        studentId: rule.studentId,
        reason: "relationship_ended",
        creatorParentId: input.parentId,
        templateId: rule.templateId,
      },
    });

    await appendOutboxEvent(tx, {
      aggregateType: "point_rule",
      aggregateId: rule.id,
      eventType: "point_rule.deactivated",
      dedupeKey: `point_rule.deactivated:rel-end:${deactivateKey}`,
      payload: {
        ruleId: rule.id,
        studentId: rule.studentId,
        reason: "relationship_ended",
      },
    });
  }

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
