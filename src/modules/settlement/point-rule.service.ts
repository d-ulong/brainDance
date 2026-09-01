import { and, eq } from "drizzle-orm";

import type { Database } from "@/db";
import { pointRuleTemplates, pointRuleVersions, pointRules, users } from "@/db/schema";
import { appendAuditEvent } from "@/modules/audit/append-audit-event";
import { requireActiveRelationship } from "@/modules/family-access/authorization.service";
import { FamilyAccessError } from "@/modules/family-access/errors";
import { appendOutboxEvent } from "@/modules/outbox/append-outbox-event";
import { hashIdempotencyPayload } from "@/modules/schedule/normalize-idempotency-payload";
import { isPostgresUniqueViolation } from "@/lib/postgres-errors";
import { SettlementError } from "@/modules/settlement/errors";
import { assertStudentAccountNotFrozen } from "@/modules/data-lifecycle/freeze-guard.service";

export const SCHEDULE_SYSTEM_COMPLETE_V1 = "schedule_system_complete_v1" as const;
export const SCHEDULE_ERROR_COUNT_V1 = "schedule_error_count_v1" as const;

export type EnablePointRuleBody =
  | { templateId: typeof SCHEDULE_SYSTEM_COMPLETE_V1 }
  | {
      templateId: typeof SCHEDULE_ERROR_COUNT_V1;
      parameters: { maximumErrorCount: number };
    };

export type EnablePointRuleInput = {
  parentId: string;
  studentId: string;
  idempotencyKey: string;
  body: EnablePointRuleBody;
  now?: Date;
  requestId?: string;
};

export type EnablePointRuleResult = {
  ruleId: string;
  ruleVersionId: string;
  idempotentReplay: boolean;
};

export type ActivePointRuleContext = {
  ruleId: string;
  ruleVersionId: string;
  templateId: string;
  parameters: Record<string, unknown>;
  effect: { amount: number; rewardsLateCompletion?: boolean };
};

async function requireVerifiedParent(db: Database, parentId: string) {
  const [parent] = await db.select().from(users).where(eq(users.id, parentId)).limit(1);
  if (!parent) {
    throw new SettlementError("NOT_FOUND", "Parent not found");
  }
  if (parent.role !== "parent") {
    throw new SettlementError("FORBIDDEN", "Only parents can enable point rules");
  }
  if (!parent.contactVerifiedAt) {
    throw new SettlementError("FORBIDDEN", "Parent contact must be verified");
  }
  return parent;
}

async function loadEnableReplay(
  db: Database,
  rule: typeof pointRules.$inferSelect,
): Promise<EnablePointRuleResult> {
  const [version] = await db
    .select({ id: pointRuleVersions.id })
    .from(pointRuleVersions)
    .where(and(eq(pointRuleVersions.pointRuleId, rule.id), eq(pointRuleVersions.version, 1)))
    .limit(1);

  if (!version) {
    throw new SettlementError("STATE_CONFLICT", "Point rule version missing on replay");
  }

  return {
    ruleId: rule.id,
    ruleVersionId: version.id,
    idempotentReplay: true,
  };
}

export async function loadActivePointRuleForStudent(
  db: Database,
  studentId: string,
  templateId: string,
): Promise<ActivePointRuleContext | null> {
  const [rule] = await db
    .select()
    .from(pointRules)
    .where(
      and(
        eq(pointRules.studentId, studentId),
        eq(pointRules.templateId, templateId),
        eq(pointRules.active, true),
      ),
    )
    .limit(1);

  if (!rule) {
    return null;
  }

  const [version] = await db
    .select()
    .from(pointRuleVersions)
    .where(and(eq(pointRuleVersions.pointRuleId, rule.id), eq(pointRuleVersions.status, "active")))
    .limit(1);

  if (!version) {
    throw new SettlementError("STATE_CONFLICT", "Active point rule is missing an active version");
  }

  const [template] = await db
    .select()
    .from(pointRuleTemplates)
    .where(eq(pointRuleTemplates.id, rule.templateId))
    .limit(1);

  if (!template) {
    throw new SettlementError("NOT_FOUND", "Point rule template not found");
  }

  const effect = version.effect as { amount: number; rewardsLateCompletion?: boolean };

  return {
    ruleId: rule.id,
    ruleVersionId: version.id,
    templateId: rule.templateId,
    parameters: version.parameters as Record<string, unknown>,
    effect,
  };
}

export async function enablePointRule(
  db: Database,
  input: EnablePointRuleInput,
): Promise<EnablePointRuleResult> {
  const now = input.now ?? new Date();
  await requireVerifiedParent(db, input.parentId);

  if (
    input.body.templateId !== SCHEDULE_SYSTEM_COMPLETE_V1 &&
    input.body.templateId !== SCHEDULE_ERROR_COUNT_V1
  ) {
    throw new SettlementError("VALIDATION_ERROR", "Unsupported point rule template");
  }

  if (input.body.templateId === SCHEDULE_ERROR_COUNT_V1) {
    const max = input.body.parameters.maximumErrorCount;
    if (!Number.isInteger(max) || max < 0) {
      throw new SettlementError("VALIDATION_ERROR", "Invalid maximumErrorCount parameter");
    }
  }

  try {
    await requireActiveRelationship(db, input.parentId, input.studentId);
  } catch (error) {
    if (error instanceof FamilyAccessError && error.code === "FORBIDDEN") {
      throw new SettlementError("FORBIDDEN", error.message);
    }
    throw error;
  }

  await assertStudentAccountNotFrozen(db, input.studentId, "write");

  const bodyHash = hashIdempotencyPayload(input.body);

  const [existing] = await db
    .select()
    .from(pointRules)
    .where(
      and(
        eq(pointRules.creatorParentId, input.parentId),
        eq(pointRules.studentId, input.studentId),
        eq(pointRules.createIdempotencyKey, input.idempotencyKey),
      ),
    )
    .limit(1);

  if (existing) {
    if (existing.createIdempotencyPayloadHash !== bodyHash) {
      throw new SettlementError(
        "IDEMPOTENCY_CONFLICT",
        "Enable point rule idempotency payload mismatch",
      );
    }
    return loadEnableReplay(db, existing);
  }

  const [template] = await db
    .select()
    .from(pointRuleTemplates)
    .where(eq(pointRuleTemplates.id, input.body.templateId))
    .limit(1);

  if (!template) {
    throw new SettlementError("NOT_FOUND", "Point rule template not found");
  }

  const [activeRule] = await db
    .select({ id: pointRules.id })
    .from(pointRules)
    .where(
      and(
        eq(pointRules.studentId, input.studentId),
        eq(pointRules.templateId, input.body.templateId),
        eq(pointRules.active, true),
      ),
    )
    .limit(1);

  if (activeRule) {
    throw new SettlementError(
      "STATE_CONFLICT",
      "Active point rule already exists for student and template",
    );
  }

  try {
    return await db.transaction(async (tx) => {
      const [rule] = await tx
        .insert(pointRules)
        .values({
          studentId: input.studentId,
          creatorParentId: input.parentId,
          templateId: input.body.templateId,
          active: true,
          createIdempotencyKey: input.idempotencyKey,
          createIdempotencyPayloadHash: bodyHash,
          createdAt: now,
        })
        .returning();

      if (!rule) {
        throw new Error("Failed to create point rule");
      }

      const [version] = await tx
        .insert(pointRuleVersions)
        .values({
          pointRuleId: rule.id,
          version: 1,
          parameters:
            input.body.templateId === SCHEDULE_ERROR_COUNT_V1 ? input.body.parameters : {},
          effect: template.effectSchema,
          priority: null,
          effectiveAt: now,
          status: "active",
        })
        .returning();

      if (!version) {
        throw new Error("Failed to create point rule version");
      }

      await appendAuditEvent(tx, {
        actorId: input.parentId,
        action: "point_rule.enabled",
        resourceType: "point_rule",
        resourceId: rule.id,
        requestId: input.requestId ?? null,
        idempotencyKey: `audit:point-rule-enabled:${rule.id}`,
        metadata: { studentId: input.studentId, templateId: input.body.templateId },
      });

      await appendOutboxEvent(tx, {
        aggregateType: "point_rule",
        aggregateId: rule.id,
        eventType: "point_rule.enabled",
        dedupeKey: `point_rule.enabled:${rule.id}`,
        payload: {
          ruleId: rule.id,
          ruleVersionId: version.id,
          studentId: input.studentId,
          templateId: input.body.templateId,
        },
      });

      return {
        ruleId: rule.id,
        ruleVersionId: version.id,
        idempotentReplay: false,
      };
    });
  } catch (error) {
    if (isPostgresUniqueViolation(error)) {
      const [raced] = await db
        .select()
        .from(pointRules)
        .where(
          and(
            eq(pointRules.creatorParentId, input.parentId),
            eq(pointRules.studentId, input.studentId),
            eq(pointRules.createIdempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);

      if (raced) {
        if (raced.createIdempotencyPayloadHash !== bodyHash) {
          throw new SettlementError(
            "IDEMPOTENCY_CONFLICT",
            "Enable point rule idempotency payload mismatch",
          );
        }
        return loadEnableReplay(db, raced);
      }

      throw new SettlementError(
        "STATE_CONFLICT",
        "Active point rule already exists for student and template",
      );
    }
    throw error;
  }
}
