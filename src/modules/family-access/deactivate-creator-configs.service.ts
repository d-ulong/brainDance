import { and, eq, sql } from "drizzle-orm";

import type { Database } from "@/db";
import { plans, pointRules } from "@/db/schema";
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
}
