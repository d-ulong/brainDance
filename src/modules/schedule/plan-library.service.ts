import { and, desc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";

import type { Database } from "@/db";
import {
  planActivations,
  planBindings,
  planItemRules,
  planLibrary,
  planLibraryCommands,
  planScheduleSlots,
  planVersions,
  plans,
  pointRules,
  pointRuleVersions,
  scheduleItems,
  users,
} from "@/db/schema";
import { appendAuditEvent } from "@/modules/audit/append-audit-event";
import { requireActiveRelationship } from "@/modules/family-access/authorization.service";
import { FamilyAccessError } from "@/modules/family-access/errors";
import { appendOutboxEvent } from "@/modules/outbox/append-outbox-event";
import {
  generatePlanOccurrences,
  planDefinitionSchema,
  type PlanDefinition,
} from "@/modules/schedule/plan-definition";
import { hashIdempotencyPayload } from "@/modules/schedule/normalize-idempotency-payload";
import { ScheduleError } from "@/modules/schedule/errors";
import { reconcileSchedulePriority } from "@/modules/schedule/reconcile-schedule-priority.service";
import { addFamilyDays } from "@/modules/time-policy/add-family-days";
import { toFamilyDate } from "@/modules/time-policy/to-family-date";

async function requireVerifiedParent(db: Database, parentId: string) {
  const [parent] = await db.select().from(users).where(eq(users.id, parentId)).limit(1);
  if (!parent || parent.role !== "parent" || !parent.contactVerifiedAt)
    throw new ScheduleError("FORBIDDEN", "已验证家长权限必需");
}
async function requirePlanCreator(db: Database, actorId: string) {
  const [actor] = await db.select().from(users).where(eq(users.id, actorId)).limit(1);
  if (!actor || actor.status !== "active")
    throw new ScheduleError("FORBIDDEN", "账号当前不可管理计划");
  if (actor.role === "parent" && actor.contactVerifiedAt) return actor;
  if (actor.role === "student" && !actor.mustChangePassword) return actor;
  throw new ScheduleError("FORBIDDEN", "当前账号不可管理计划");
}
function withoutStudentAwardPoints(definition: PlanDefinition): PlanDefinition {
  return {
    ...definition,
    entries: definition.entries.map((entry) => ({
      ...entry,
      points: {
        onTimeWithin: 0,
        onTimeOver: 0,
        lateWithin: 0,
        lateOver: 0,
        incomplete: 0,
      },
    })),
  };
}
async function requireLinked(db: Database, parentId: string, studentId: string) {
  try {
    await requireActiveRelationship(db, parentId, studentId);
  } catch (error) {
    if (error instanceof FamilyAccessError) throw new ScheduleError("FORBIDDEN", error.message);
    throw error;
  }
}
export async function createPlanLibrary(
  db: Database,
  input: { ownerId: string; definition: unknown; priority?: number; idempotencyKey: string },
) {
  const actor = await requirePlanCreator(db, input.ownerId);
  const parsedDefinition = planDefinitionSchema.parse(input.definition) as PlanDefinition;
  const definition = actor.role === "student" ? withoutStudentAwardPoints(parsedDefinition) : parsedDefinition;
  const priority = input.priority ?? 0;
  if (!Number.isInteger(priority) || priority < 0 || priority > 100) throw new ScheduleError("STATE_CONFLICT", "计划优先级必须为 0 到 100 的整数");
  const hash = hashIdempotencyPayload({ definition, priority });
  return db.transaction(async (tx) => {
    // library IDs are UUIDs, so use a dedicated advisory lock for create idempotency and only then create.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`plan-library:${input.ownerId}:${input.idempotencyKey}`}, 0))`,
    );
    const [command] = await tx
      .select()
      .from(planLibraryCommands)
      .where(
        and(
          eq(planLibraryCommands.actorId, input.ownerId),
          eq(planLibraryCommands.key, input.idempotencyKey),
        ),
      )
      .limit(1);
    if (command) {
      if (command.payloadHash !== hash)
        throw new ScheduleError("IDEMPOTENCY_CONFLICT", "计划保存请求内容不一致");
      const libraryId = command.result.libraryId;
      if (typeof libraryId !== "string")
        throw new ScheduleError("STATE_CONFLICT", "计划保存重放记录无效");
      const [existing] = await tx
        .select()
        .from(planLibrary)
        .where(eq(planLibrary.id, libraryId))
        .limit(1);
      if (!existing) throw new ScheduleError("STATE_CONFLICT", "计划保存重放内容不存在");
      return existing;
    }
    const [entry] = await tx
      .insert(planLibrary)
      .values({ ownerId: input.ownerId, definition, priority })
      .returning();
    if (!entry) throw new ScheduleError("STATE_CONFLICT", "计划内容保存失败");
    await tx
      .insert(planLibraryCommands)
      .values({
        actorId: input.ownerId,
        key: input.idempotencyKey,
        payloadHash: hash,
        result: { libraryId: entry.id },
      });
    await appendAuditEvent(tx, {
      actorId: input.ownerId,
      action: "plan_library.created",
      resourceType: "plan_library",
      resourceId: entry.id,
      idempotencyKey: `audit:plan-library:${entry.id}`,
      metadata: { hash },
    });
    await appendOutboxEvent(tx, {
      aggregateType: "plan_library",
      aggregateId: entry.id,
      eventType: "plan_library.created",
      dedupeKey: `plan_library.created:${entry.id}`,
      payload: { libraryId: entry.id },
    });
    return entry;
  });
}

export type PlanLibraryBindingSummary = {
  studentId: string;
  displayName: string;
  username: string | null;
  effectiveFrom: string;
};

export type PlanLibrarySummary = Omit<typeof planLibrary.$inferSelect, "definition"> & {
  definition: PlanDefinition;
  bindings: PlanLibraryBindingSummary[];
  ownerName?: string;
  canEdit?: boolean;
  boundToSelf?: boolean;
};

export async function listPlanLibrary(
  db: Database,
  ownerId: string,
): Promise<PlanLibrarySummary[]> {
  await requireVerifiedParent(db, ownerId);
  const libraries = await db
    .select()
    .from(planLibrary)
    .where(eq(planLibrary.ownerId, ownerId))
    .orderBy(planLibrary.updatedAt);
  if (!libraries.length) return [];

  const bindings = await db
    .select({
      libraryId: planBindings.libraryId,
      studentId: planBindings.studentId,
      displayName: users.displayName,
      username: users.username,
      effectiveFrom: planActivations.effectiveFrom,
    })
    .from(planBindings)
    .innerJoin(planActivations, eq(planActivations.bindingId, planBindings.id))
    .innerJoin(planLibrary, eq(planLibrary.id, planBindings.libraryId))
    .innerJoin(users, eq(users.id, planBindings.studentId))
    .where(and(eq(planLibrary.ownerId, ownerId), sql`${planActivations.effectiveUntil} IS NULL`));

  const bindingsByLibrary = new Map<string, PlanLibraryBindingSummary[]>();
  for (const binding of bindings) {
    const current = bindingsByLibrary.get(binding.libraryId) ?? [];
    current.push({
      studentId: binding.studentId,
      displayName: binding.displayName,
      username: binding.username,
      effectiveFrom: binding.effectiveFrom,
    });
    bindingsByLibrary.set(binding.libraryId, current);
  }
  return libraries.map((library) => ({
    ...library,
    definition: planDefinitionSchema.parse(library.definition) as PlanDefinition,
    bindings: bindingsByLibrary.get(library.id) ?? [],
    canEdit: true,
  }));
}

export async function listStudentPlanLibrary(
  db: Database,
  studentId: string,
): Promise<PlanLibrarySummary[]> {
  await requirePlanCreator(db, studentId);
  const activeBindings = await db
    .select({ libraryId: planBindings.libraryId, effectiveFrom: planActivations.effectiveFrom })
    .from(planBindings)
    .innerJoin(planActivations, eq(planActivations.bindingId, planBindings.id))
    .where(
      and(
        eq(planBindings.studentId, studentId),
        sql`${planActivations.effectiveUntil} IS NULL`,
      ),
    );
  const boundIds = [...new Set(activeBindings.map((binding) => binding.libraryId))];
  const libraries = await db
    .select({ library: planLibrary, ownerName: users.displayName })
    .from(planLibrary)
    .innerJoin(users, eq(users.id, planLibrary.ownerId))
    .where(
      boundIds.length
        ? or(eq(planLibrary.ownerId, studentId), inArray(planLibrary.id, boundIds))
        : eq(planLibrary.ownerId, studentId),
    )
    .orderBy(desc(planLibrary.updatedAt));
  const effectiveFromByLibrary = new Map(
    activeBindings.map((binding) => [binding.libraryId, binding.effectiveFrom]),
  );
  return libraries.map(({ library, ownerName }) => ({
    ...library,
    definition: planDefinitionSchema.parse(library.definition) as PlanDefinition,
    ownerName,
    canEdit: library.ownerId === studentId,
    boundToSelf: effectiveFromByLibrary.has(library.id),
    bindings: effectiveFromByLibrary.has(library.id)
      ? [
          {
            studentId,
            displayName: "我",
            username: null,
            effectiveFrom: effectiveFromByLibrary.get(library.id)!,
          },
        ]
      : [],
  }));
}

/**
 * Removes the current application of one library to one student while preserving
 * the binding and execution history for audit. Pending work is cancelled, never
 * converted to an incomplete item or a penalty.
 */
export async function removePlanLibraryBinding(
  db: Database,
  input: {
    ownerId: string;
    libraryId: string;
    studentId: string;
    idempotencyKey: string;
    now?: Date;
  },
) {
  await requireVerifiedParent(db, input.ownerId);
  if (input.ownerId !== input.studentId) await requireLinked(db, input.ownerId, input.studentId);
  const now = input.now ?? new Date();
  const today = toFamilyDate(now);
  const payloadHash = hashIdempotencyPayload({
    libraryId: input.libraryId,
    studentId: input.studentId,
    operation: "remove-binding",
  });

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM users WHERE id = ${input.studentId}::uuid FOR UPDATE`);
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`plan-remove:${input.ownerId}:${input.idempotencyKey}`}, 0))`,
    );
    const [command] = await tx
      .select()
      .from(planLibraryCommands)
      .where(
        and(
          eq(planLibraryCommands.actorId, input.ownerId),
          eq(planLibraryCommands.key, input.idempotencyKey),
        ),
      )
      .limit(1);
    if (command) {
      if (command.payloadHash !== payloadHash) {
        throw new ScheduleError("IDEMPOTENCY_CONFLICT", "移除学生请求内容不一致");
      }
      return { idempotentReplay: true };
    }
    const [library] = await tx
      .select({ id: planLibrary.id })
      .from(planLibrary)
      .where(and(eq(planLibrary.id, input.libraryId), eq(planLibrary.ownerId, input.ownerId)))
      .limit(1);
    if (!library) throw new ScheduleError("NOT_FOUND", "计划内容不存在");

    const [activation] = await tx
      .select({
        id: planActivations.id,
        executionPlanId: planActivations.executionPlanId,
        effectiveFrom: planActivations.effectiveFrom,
      })
      .from(planActivations)
      .innerJoin(planBindings, eq(planBindings.id, planActivations.bindingId))
      .where(
        and(
          eq(planBindings.libraryId, input.libraryId),
          eq(planBindings.studentId, input.studentId),
          sql`${planActivations.effectiveUntil} IS NULL`,
        ),
      )
      .limit(1);
    if (!activation) throw new ScheduleError("NOT_FOUND", "该学生当前未绑定此计划");

    // An activation scheduled for the future ends at its own start date; this is
    // an empty half-open interval and keeps the historical activation immutable.
    const effectiveUntil = activation.effectiveFrom > today ? activation.effectiveFrom : today;
    await tx
      .update(planActivations)
      .set({ effectiveUntil })
      .where(eq(planActivations.id, activation.id));
    await tx
      .update(plans)
      .set({ status: "inactive" })
      .where(eq(plans.id, activation.executionPlanId));
    const cancelled = await tx
      .update(scheduleItems)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(scheduleItems.planId, activation.executionPlanId),
          eq(scheduleItems.status, "pending"),
          gte(scheduleItems.familyDate, today),
        ),
      )
      .returning({ id: scheduleItems.id });
    await tx.insert(planLibraryCommands).values({
      actorId: input.ownerId,
      key: input.idempotencyKey,
      payloadHash,
      result: {
        operation: "remove-binding",
        activationId: activation.id,
        cancelledItems: cancelled.length,
      },
    });
    await appendAuditEvent(tx, {
      actorId: input.ownerId,
      action: "plan_library.binding_removed",
      resourceType: "plan_activation",
      resourceId: activation.id,
      idempotencyKey: `audit:plan-remove:${input.idempotencyKey}`,
      metadata: {
        studentId: input.studentId,
        libraryId: input.libraryId,
        cancelledItems: cancelled.length,
      },
    });
    await appendOutboxEvent(tx, {
      aggregateType: "plan_activation",
      aggregateId: activation.id,
      eventType: "plan_library.binding_removed",
      dedupeKey: `plan_library.binding_removed:${input.ownerId}:${input.idempotencyKey}`,
      payload: {
        activationId: activation.id,
        studentId: input.studentId,
        libraryId: input.libraryId,
      },
    });
    return { idempotentReplay: false, cancelledItems: cancelled.length };
  });
}
export async function updatePlanLibrary(
  db: Database,
  input: {
    ownerId: string;
    libraryId: string;
    revision: number;
    definition: unknown;
    priority?: number;
    idempotencyKey: string;
  },
) {
  const actor = await requirePlanCreator(db, input.ownerId);
  const parsedDefinition = planDefinitionSchema.parse(input.definition) as PlanDefinition;
  const definition = actor.role === "student" ? withoutStudentAwardPoints(parsedDefinition) : parsedDefinition;
  const priority = input.priority ?? 0;
  if (!Number.isInteger(priority) || priority < 0 || priority > 100) throw new ScheduleError("STATE_CONFLICT", "计划优先级必须为 0 到 100 的整数");
  const payloadHash = hashIdempotencyPayload({
    libraryId: input.libraryId,
    revision: input.revision,
    definition,
    priority,
  });
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`plan-update:${input.ownerId}:${input.idempotencyKey}`}, 0))`,
    );
    const [command] = await tx
      .select()
      .from(planLibraryCommands)
      .where(
        and(
          eq(planLibraryCommands.actorId, input.ownerId),
          eq(planLibraryCommands.key, input.idempotencyKey),
        ),
      )
      .limit(1);
    if (command) {
      if (command.payloadHash !== payloadHash)
        throw new ScheduleError("IDEMPOTENCY_CONFLICT", "计划编辑请求内容不一致");
      const [replay] = await tx
        .select()
        .from(planLibrary)
        .where(eq(planLibrary.id, input.libraryId))
        .limit(1);
      if (!replay) throw new ScheduleError("STATE_CONFLICT", "计划编辑重放内容不存在");
      return replay;
    }
    const [current] = await tx
      .select()
      .from(planLibrary)
      .where(and(eq(planLibrary.id, input.libraryId), eq(planLibrary.ownerId, input.ownerId)))
      .limit(1);
    if (!current) throw new ScheduleError("NOT_FOUND", "计划内容不存在");
    if (current.revision !== input.revision)
      throw new ScheduleError("STATE_CONFLICT", "计划已更新，请刷新后再编辑");
    const [updated] = await tx
      .update(planLibrary)
      .set({ definition, priority, revision: current.revision + 1, updatedAt: new Date() })
      .where(eq(planLibrary.id, current.id))
      .returning();
    if (!updated) throw new ScheduleError("STATE_CONFLICT", "计划编辑失败");
    await tx
      .insert(planLibraryCommands)
      .values({
        actorId: input.ownerId,
        key: input.idempotencyKey,
        payloadHash,
        result: { operation: "update", libraryId: updated.id },
      });
    await appendAuditEvent(tx, {
      actorId: input.ownerId,
      action: "plan_library.updated",
      resourceType: "plan_library",
      resourceId: updated.id,
      idempotencyKey: `audit:plan-update:${input.idempotencyKey}`,
      metadata: { revision: updated.revision },
    });
    await appendOutboxEvent(tx, {
      aggregateType: "plan_library",
      aggregateId: updated.id,
      eventType: "plan_library.updated",
      dedupeKey: `plan_library.updated:${updated.id}:${updated.revision}`,
      payload: { libraryId: updated.id, revision: updated.revision },
    });
    return updated;
  });
}

export async function activatePlanLibrary(
  db: Database,
  input: {
    ownerId: string;
    libraryId: string;
    studentId: string;
    effectiveFrom?: string;
    idempotencyKey: string;
    now?: Date;
  },
) {
  const actor = await requirePlanCreator(db, input.ownerId);
  if (actor.role === "parent" && input.ownerId !== input.studentId)
    await requireLinked(db, input.ownerId, input.studentId);
  else if (input.ownerId !== input.studentId)
    throw new ScheduleError("FORBIDDEN", "学生只能为自己启用计划");
  const now = input.now ?? new Date();
  const today = toFamilyDate(now);
  const effectiveFrom = input.effectiveFrom ?? addFamilyDays(today, 1);
  if (effectiveFrom < today) throw new ScheduleError("WINDOW_EXPIRED", "不能为过去日期切换计划");
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM users WHERE id = ${input.studentId}::uuid FOR UPDATE`);
    const [library] = await tx
      .select()
      .from(planLibrary)
      .where(and(eq(planLibrary.id, input.libraryId), eq(planLibrary.ownerId, input.ownerId)))
      .limit(1);
    if (!library) throw new ScheduleError("NOT_FOUND", "计划内容不存在");
    const storedDefinition = planDefinitionSchema.parse(library.definition) as PlanDefinition;
    const definition = input.ownerId === input.studentId
      ? withoutStudentAwardPoints(storedDefinition)
      : storedDefinition;
    const payloadHash = hashIdempotencyPayload({
      libraryId: input.libraryId,
      studentId: input.studentId,
      effectiveFrom,
    });
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`plan-activate:${input.ownerId}:${input.idempotencyKey}`}, 0))`,
    );
    const [binding] = await tx
      .insert(planBindings)
      .values({ libraryId: library.id, studentId: input.studentId })
      .onConflictDoNothing()
      .returning();
    const activeBinding =
      binding ??
      (
        await tx
          .select()
          .from(planBindings)
          .where(
            and(
              eq(planBindings.libraryId, library.id),
              eq(planBindings.studentId, input.studentId),
            ),
          )
          .limit(1)
      )[0];
    if (!activeBinding) throw new ScheduleError("STATE_CONFLICT", "计划绑定失败");
    const [executionPlan] = await tx
      .insert(plans)
      .values({
        studentId: input.studentId,
        ownerId: input.ownerId,
        planKind: input.ownerId === input.studentId ? "personal" : "formal",
        status: "active",
        title: definition.title,
        description: definition.description ?? null,
        startDate: effectiveFrom,
        endDate: definition.endDate ?? null,
        createIdempotencyKey: input.idempotencyKey,
        createIdempotencyPayloadHash: payloadHash,
      })
      .returning();
    if (!executionPlan) throw new ScheduleError("STATE_CONFLICT", "执行计划创建失败");
    const [version] = await tx
      .insert(planVersions)
      .values({
        planId: executionPlan.id,
        version: 1,
        scheduleRule: { source: "plan_library", libraryId: library.id, revision: library.revision },
        effectiveFrom,
        effectiveUntil: null,
        createdAt: now,
        createIdempotencyKey: input.idempotencyKey,
        createIdempotencyPayloadHash: payloadHash,
      })
      .returning();
    if (!version) throw new ScheduleError("STATE_CONFLICT", "执行计划版本创建失败");
    await tx
      .update(plans)
      .set({ currentVersion: version.id })
      .where(eq(plans.id, executionPlan.id));
    const [rule] = await tx
      .insert(pointRules)
      .values({
        studentId: input.studentId,
        creatorParentId: input.ownerId,
        templateId: "plan_entry_conditions_v1",
        active: false,
        createIdempotencyKey: `plan-activation:${executionPlan.id}`,
        createIdempotencyPayloadHash: payloadHash,
        createdAt: now,
      })
      .returning();
    if (!rule) throw new ScheduleError("STATE_CONFLICT", "计划积分规则创建失败");
    const ruleVersions = await tx
      .insert(pointRuleVersions)
      .values(
        definition.entries.map((entry, index) => ({
          pointRuleId: rule.id,
          version: index + 1,
          parameters: { entryKey: entry.key },
          effect: entry.points,
          effectiveAt: now,
          status: "active",
        })),
      )
      .returning({ id: pointRuleVersions.id, version: pointRuleVersions.version });
    if (ruleVersions.length !== definition.entries.length)
      throw new ScheduleError("STATE_CONFLICT", "计划积分规则版本创建失败");
    const ruleVersionByEntryKey = new Map(
      definition.entries.map((entry, index) => [entry.key, ruleVersions[index]!.id]),
    );
    await tx
      .insert(planScheduleSlots)
      .values(
        definition.entries.map((entry) => ({
          planVersionId: version.id,
          slotKey: entry.key,
          localTime: entry.expectedTime,
        })),
      );
    const [activation] = await tx
      .insert(planActivations)
      .values({
        bindingId: activeBinding.id,
        studentId: input.studentId,
        executionPlanId: executionPlan.id,
        ruleId: rule.id,
        effectiveFrom,
        definition,
        revision: library.revision,
      })
      .returning();
    const through = addFamilyDays(effectiveFrom, 14);
    const occurrences = generatePlanOccurrences(definition, effectiveFrom, through);
    if (occurrences.length) {
      const insertedItems = await tx
        .insert(scheduleItems)
        .values(
          occurrences.map(({ entry, familyDate, scheduledAt }) => ({
            planId: executionPlan.id,
            planVersionId: version.id,
            studentId: input.studentId,
            ownerId: input.ownerId,
            familyDate,
            slotKey: entry.key,
            scheduledAt,
            status: "pending",
            source: "plan",
            occurrenceKey: `library:${activation!.id}:${entry.key}:${familyDate}`,
            planSnapshot: { libraryId: library.id, revision: library.revision, entry },
            priority: library.priority,
          })),
        )
        .onConflictDoNothing({ target: scheduleItems.occurrenceKey })
        .returning({ id: scheduleItems.id, slotKey: scheduleItems.slotKey });
      if (insertedItems.length)
        await tx
          .insert(planItemRules)
          .values(
            insertedItems.map((item) => ({
              scheduleItemId: item.id,
              ruleVersionId: ruleVersionByEntryKey.get(item.slotKey)!,
              entry: definition.entries.find((entry) => entry.key === item.slotKey)!,
            })),
          );
    }
    await reconcileSchedulePriority(tx, { studentId: input.studentId, scheduledAts: occurrences.map((item) => item.scheduledAt) });
    await appendAuditEvent(tx, {
      actorId: input.ownerId,
      action: "plan_library.activated",
      resourceType: "plan_activation",
      resourceId: activation!.id,
      idempotencyKey: `audit:plan-activate:${activation!.id}`,
      metadata: {
        studentId: input.studentId,
        libraryId: library.id,
        effectiveFrom,
        priority: library.priority,
      },
    });
    await appendOutboxEvent(tx, {
      aggregateType: "plan_activation",
      aggregateId: activation!.id,
      eventType: "plan_library.activated",
      dedupeKey: `plan_library.activated:${activation!.id}`,
      payload: {
        activationId: activation!.id,
        studentId: input.studentId,
        executionPlanId: executionPlan.id,
        effectiveFrom,
      },
    });
    return {
      activationId: activation!.id,
      planId: executionPlan.id,
      itemsCreated: occurrences.length,
      effectiveFrom,
    };
  });
}

/** Generate a requested future range for the student's currently active library binding.
 * Existing occurrence keys make overlapping requests harmless. */
export async function generatePlanLibraryRange(
  db: Database,
  input: {
    ownerId: string;
    libraryId: string;
    studentId: string;
    from: string;
    through: string;
    idempotencyKey: string;
    now?: Date;
  },
) {
  const actor = await requirePlanCreator(db, input.ownerId);
  if (actor.role === "parent" && input.ownerId !== input.studentId)
    await requireLinked(db, input.ownerId, input.studentId);
  else if (input.ownerId !== input.studentId)
    throw new ScheduleError("FORBIDDEN", "学生只能生成自己的日程");
  const now = input.now ?? new Date();
  const today = toFamilyDate(now);
  if (
    input.from < today ||
    input.through < input.from ||
    input.through > addFamilyDays(today, 89)
  ) {
    throw new ScheduleError("WINDOW_EXPIRED", "只能生成今天起、最多连续 90 天的日程");
  }
  const payloadHash = hashIdempotencyPayload({
    libraryId: input.libraryId,
    studentId: input.studentId,
    from: input.from,
    through: input.through,
  });
  const [authorizedLibrary] = await db
    .select({ ownerId: planLibrary.ownerId })
    .from(planLibrary)
    .where(eq(planLibrary.id, input.libraryId))
    .limit(1);
  if (!authorizedLibrary) throw new ScheduleError("NOT_FOUND", "计划内容不存在");
  if (actor.role === "parent" && authorizedLibrary.ownerId !== input.ownerId)
    throw new ScheduleError("FORBIDDEN", "只能生成自己创建的计划");
  if (actor.role === "student") {
    const [binding] = await db
      .select({ id: planBindings.id })
      .from(planBindings)
      .innerJoin(planActivations, eq(planActivations.bindingId, planBindings.id))
      .where(
        and(
          eq(planBindings.libraryId, input.libraryId),
          eq(planBindings.studentId, input.studentId),
          sql`${planActivations.effectiveUntil} IS NULL`,
        ),
      )
      .limit(1);
    if (!binding)
      throw new ScheduleError("FORBIDDEN", "只能为当前已启用的计划生成日程");
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM users WHERE id = ${input.studentId}::uuid FOR UPDATE`);
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`plan-generate:${input.ownerId}:${input.idempotencyKey}`}, 0))`,
    );
    const [command] = await tx
      .select()
      .from(planLibraryCommands)
      .where(
        and(
          eq(planLibraryCommands.actorId, input.ownerId),
          eq(planLibraryCommands.key, input.idempotencyKey),
        ),
      )
      .limit(1);
    if (command) {
      if (command.payloadHash !== payloadHash || command.result.operation !== "generate")
        throw new ScheduleError("IDEMPOTENCY_CONFLICT", "日程生成请求内容不一致");
      return {
        ...(command.result as { itemsCreated: number; activationId: string }),
        idempotentReplay: true,
      };
    }
    const [activation] = await tx
      .select()
      .from(planActivations)
      .innerJoin(planBindings, eq(planActivations.bindingId, planBindings.id))
      .where(
        and(
          eq(planActivations.studentId, input.studentId),
          eq(planBindings.libraryId, input.libraryId),
          lte(planActivations.effectiveFrom, input.through),
          sql`(${planActivations.effectiveUntil} IS NULL OR ${planActivations.effectiveUntil} > ${input.from})`,
        ),
      )
      .orderBy(desc(planActivations.effectiveFrom))
      .limit(1);
    if (!activation)
      throw new ScheduleError("NOT_FOUND", "所选日期内没有这套计划的生效区间");
    const generatedFrom =
      input.from < activation.plan_activations.effectiveFrom
        ? activation.plan_activations.effectiveFrom
        : input.from;
    const effectiveThrough = activation.plan_activations.effectiveUntil
      ? addFamilyDays(activation.plan_activations.effectiveUntil, -1)
      : input.through;
    const generatedThrough = input.through < effectiveThrough ? input.through : effectiveThrough;
    const definition = planDefinitionSchema.parse(
      activation.plan_activations.definition,
    ) as PlanDefinition;
    const [library] = await tx
      .select({ priority: planLibrary.priority, ownerId: planLibrary.ownerId })
      .from(planLibrary)
      .where(eq(planLibrary.id, input.libraryId))
      .limit(1);
    if (!library) throw new ScheduleError("NOT_FOUND", "计划内容不存在");
    const occurrences = generatePlanOccurrences(definition, generatedFrom, generatedThrough);
    const [executionPlan] = await tx
      .select({ currentVersion: plans.currentVersion })
      .from(plans)
      .where(eq(plans.id, activation.plan_activations.executionPlanId))
      .limit(1);
    const versionId = executionPlan?.currentVersion;
    if (!versionId) throw new ScheduleError("STATE_CONFLICT", "执行计划版本不存在");
    if (!activation.plan_activations.ruleId)
      throw new ScheduleError("STATE_CONFLICT", "计划积分规则不存在");
    const ruleVersions = await tx
      .select({ id: pointRuleVersions.id, version: pointRuleVersions.version })
      .from(pointRuleVersions)
      .where(eq(pointRuleVersions.pointRuleId, activation.plan_activations.ruleId));
    const ruleVersionByEntryKey = new Map(
      definition.entries.map((entry, index) => [
        entry.key,
        ruleVersions.find((row) => row.version === index + 1)?.id,
      ]),
    );
    if ([...ruleVersionByEntryKey.values()].some((value) => !value))
      throw new ScheduleError("STATE_CONFLICT", "计划积分规则版本不存在");
    const inserted = occurrences.length
      ? await tx
          .insert(scheduleItems)
          .values(
            occurrences.map(({ entry, familyDate, scheduledAt }) => ({
              planId: activation.plan_activations.executionPlanId,
              planVersionId: versionId,
              studentId: input.studentId,
              ownerId: library.ownerId,
              familyDate,
              slotKey: entry.key,
              scheduledAt,
              status: "pending",
              source: "plan",
              occurrenceKey: `library:${activation.plan_activations.id}:${entry.key}:${familyDate}`,
              planSnapshot: {
                libraryId: input.libraryId,
                revision: activation.plan_activations.revision,
                entry,
              },
              priority: library.priority,
            })),
          )
          .onConflictDoNothing({ target: scheduleItems.occurrenceKey })
          .returning({ id: scheduleItems.id, slotKey: scheduleItems.slotKey })
      : [];
    if (inserted.length)
      await tx
        .insert(planItemRules)
        .values(
          inserted.map((item) => ({
            scheduleItemId: item.id,
            ruleVersionId: ruleVersionByEntryKey.get(item.slotKey)!,
            entry: definition.entries.find((entry) => entry.key === item.slotKey)!,
          })),
        );
    await reconcileSchedulePriority(tx, { studentId: input.studentId, scheduledAts: occurrences.map((item) => item.scheduledAt) });
    const result = {
      operation: "generate",
      activationId: activation.plan_activations.id,
      itemsCreated: inserted.length,
      generatedFrom,
      generatedThrough,
    };
    await tx
      .insert(planLibraryCommands)
      .values({ actorId: input.ownerId, key: input.idempotencyKey, payloadHash, result });
    await appendAuditEvent(tx, {
      actorId: input.ownerId,
      action: "plan_library.range_generated",
      resourceType: "plan_activation",
      resourceId: activation.plan_activations.id,
      idempotencyKey: `audit:plan-generate:${input.idempotencyKey}`,
      metadata: {
        studentId: input.studentId,
        libraryId: input.libraryId,
        from: input.from,
        through: input.through,
        generatedFrom,
        generatedThrough,
        itemsCreated: inserted.length,
      },
    });
    await appendOutboxEvent(tx, {
      aggregateType: "plan_activation",
      aggregateId: activation.plan_activations.id,
      eventType: "plan_library.range_generated",
      dedupeKey: `plan_library.range_generated:${input.ownerId}:${input.idempotencyKey}`,
      payload: {
        studentId: input.studentId,
        libraryId: input.libraryId,
        from: input.from,
        through: input.through,
        generatedFrom,
        generatedThrough,
        itemsCreated: inserted.length,
      },
    });
    return {
      activationId: activation.plan_activations.id,
      itemsCreated: inserted.length,
      generatedFrom,
      generatedThrough,
      idempotentReplay: false,
    };
  });
}
