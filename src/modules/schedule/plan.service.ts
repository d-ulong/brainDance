import { and, eq, sql } from "drizzle-orm";

import type { Database } from "@/db";
import { planScheduleSlots, planVersions, plans, type plans as plansTable } from "@/db/schema";
import { appendAuditEvent } from "@/modules/audit/append-audit-event";
import { requireActiveRelationship } from "@/modules/family-access/authorization.service";
import { FamilyAccessError } from "@/modules/family-access/errors";
import { appendOutboxEvent } from "@/modules/outbox/append-outbox-event";
import {
  generateHorizonInline,
  type PlanSnapshot,
} from "@/modules/schedule/generate-horizon-inline.service";
import { hashIdempotencyPayload } from "@/modules/schedule/normalize-idempotency-payload";
import {
  cancelPendingAfterEndDate,
  persistExpiredPastWindow,
} from "@/modules/schedule/persist-expired.service";
import { ScheduleError } from "@/modules/schedule/errors";
import { horizonThrough } from "@/modules/time-policy/horizon-through";
import { nextFamilyDate } from "@/modules/time-policy/next-family-date";
import { toFamilyDate } from "@/modules/time-policy/to-family-date";
import { isPostgresUniqueViolation } from "@/lib/postgres-errors";
import { users } from "@/db/schema";
import { assertStudentAccountNotFrozen } from "@/modules/data-lifecycle/freeze-guard.service";

export type CreateFormalPlanBody = {
  title: string;
  description?: string | null;
  localTime: string;
  startDate: string;
  endDate?: string | null;
};

export type CreateFormalPlanInput = {
  ownerId: string;
  studentId: string;
  idempotencyKey: string;
  body: CreateFormalPlanBody;
  now?: Date;
  requestId?: string;
};

export type FormalPlanResult = {
  planId: string;
  versionId: string;
  localTime: string;
  itemsCreated: number;
  idempotentReplay: boolean;
};

export type EditFormalPlanBody = {
  title?: string | null;
  description?: string | null;
  localTime?: string | null;
  endDate?: string | null;
};

export type EditFormalPlanInput = {
  ownerId: string;
  planId: string;
  idempotencyKey: string;
  body: EditFormalPlanBody;
  now?: Date;
  requestId?: string;
};

export type EditFormalPlanResult = {
  planId: string;
  versionId: string;
  localTime: string;
  itemsCreated: number;
  idempotentReplay: boolean;
};

export type DeactivateFormalPlanInput = {
  ownerId: string;
  planId: string;
  idempotencyKey: string;
  now?: Date;
  requestId?: string;
};

export type DeactivateFormalPlanResult = {
  planId: string;
  status: "inactive";
  idempotentReplay: boolean;
};

function toPlanSnapshot(plan: typeof plansTable.$inferSelect): PlanSnapshot {
  return {
    id: plan.id,
    owner_id: plan.ownerId,
    student_id: plan.studentId,
    plan_kind: plan.planKind,
    status: plan.status,
    title: plan.title,
    description: plan.description,
    start_date: plan.startDate,
    end_date: plan.endDate,
    current_version: plan.currentVersion!,
  };
}

async function requireVerifiedParent(db: Database, parentId: string) {
  const [parent] = await db.select().from(users).where(eq(users.id, parentId)).limit(1);
  if (!parent) {
    throw new ScheduleError("NOT_FOUND", "Parent not found");
  }
  if (parent.role !== "parent") {
    throw new ScheduleError("FORBIDDEN", "Only parents can manage formal plans");
  }
  if (!parent.contactVerifiedAt) {
    throw new ScheduleError("FORBIDDEN", "Parent contact must be verified");
  }
  return parent;
}

async function loadPlanVersionSlotLocalTime(
  db: Database,
  versionId: string,
): Promise<string | null> {
  const [slot] = await db
    .select({ localTime: planScheduleSlots.localTime })
    .from(planScheduleSlots)
    .where(
      and(eq(planScheduleSlots.planVersionId, versionId), eq(planScheduleSlots.slotKey, "default")),
    )
    .limit(1);

  return slot?.localTime ?? null;
}

async function assertPlanOwner(db: Database, planId: string, ownerId: string): Promise<void> {
  const [plan] = await db
    .select({ ownerId: plans.ownerId })
    .from(plans)
    .where(eq(plans.id, planId))
    .limit(1);

  if (!plan) {
    throw new ScheduleError("NOT_FOUND", "Plan not found");
  }

  if (plan.ownerId !== ownerId) {
    throw new ScheduleError("FORBIDDEN", "Only the plan owner can manage this plan");
  }
}

async function loadEditReplay(
  db: Database,
  planId: string,
  version: typeof planVersions.$inferSelect,
): Promise<EditFormalPlanResult> {
  const localTime = await loadPlanVersionSlotLocalTime(db, version.id);
  if (!localTime) {
    throw new ScheduleError("SLOT_INVARIANT", "Plan version slot missing");
  }

  return {
    planId,
    versionId: version.id,
    localTime,
    itemsCreated: 0,
    idempotentReplay: true,
  };
}

async function findEditVersionReplay(
  db: Database,
  planId: string,
  idempotencyKey: string,
  bodyHash: string,
): Promise<EditFormalPlanResult | "conflict" | null> {
  const [existingVersion] = await db
    .select()
    .from(planVersions)
    .where(
      and(eq(planVersions.planId, planId), eq(planVersions.createIdempotencyKey, idempotencyKey)),
    )
    .limit(1);

  if (!existingVersion) {
    return null;
  }

  if (existingVersion.createIdempotencyPayloadHash !== bodyHash) {
    return "conflict";
  }

  return loadEditReplay(db, planId, existingVersion);
}

function findDeactivateReplay(
  plan: typeof plansTable.$inferSelect,
  idempotencyKey: string,
  bodyHash: string,
): DeactivateFormalPlanResult | "conflict" | null {
  if (plan.deactivateIdempotencyKey !== idempotencyKey) {
    return null;
  }

  if (plan.deactivateIdempotencyPayloadHash !== bodyHash) {
    return "conflict";
  }

  return {
    planId: plan.id,
    status: "inactive",
    idempotentReplay: true,
  };
}

async function loadCreateReplay(
  db: Database,
  plan: typeof plansTable.$inferSelect,
): Promise<FormalPlanResult> {
  const versionId = plan.currentVersion;
  if (!versionId) {
    throw new ScheduleError("STATE_CONFLICT", "Plan is missing current version");
  }

  const localTime = await loadPlanVersionSlotLocalTime(db, versionId);
  if (!localTime) {
    throw new ScheduleError("SLOT_INVARIANT", "Plan version slot missing");
  }

  return {
    planId: plan.id,
    versionId,
    localTime,
    itemsCreated: 0,
    idempotentReplay: true,
  };
}

export async function createFormalPlan(
  db: Database,
  input: CreateFormalPlanInput,
): Promise<FormalPlanResult> {
  const now = input.now ?? new Date();
  await requireVerifiedParent(db, input.ownerId);

  try {
    await requireActiveRelationship(db, input.ownerId, input.studentId);
  } catch (error) {
    if (error instanceof FamilyAccessError && error.code === "FORBIDDEN") {
      throw new ScheduleError("FORBIDDEN", error.message);
    }
    throw error;
  }

  await assertStudentAccountNotFrozen(db, input.studentId, "write");

  const bodyHash = hashIdempotencyPayload(input.body);

  const [existing] = await db
    .select()
    .from(plans)
    .where(
      and(
        eq(plans.ownerId, input.ownerId),
        eq(plans.studentId, input.studentId),
        eq(plans.createIdempotencyKey, input.idempotencyKey),
      ),
    )
    .limit(1);

  if (existing) {
    if (existing.createIdempotencyPayloadHash !== bodyHash) {
      throw new ScheduleError("IDEMPOTENCY_CONFLICT", "Create plan idempotency payload mismatch");
    }
    return loadCreateReplay(db, existing);
  }

  const [activePlan] = await db
    .select({ id: plans.id })
    .from(plans)
    .where(
      and(
        eq(plans.studentId, input.studentId),
        eq(plans.status, "active"),
        eq(plans.planKind, "formal"),
      ),
    )
    .limit(1);

  if (activePlan) {
    throw new ScheduleError("STATE_CONFLICT", "Active formal plan already exists for student");
  }

  try {
    return await db.transaction(async (tx) => {
      const createdAt = now;
      const [plan] = await tx
        .insert(plans)
        .values({
          studentId: input.studentId,
          ownerId: input.ownerId,
          goalId: null,
          planKind: "formal",
          sourcePlanId: null,
          status: "active",
          title: input.body.title,
          description: input.body.description ?? null,
          startDate: input.body.startDate,
          endDate: input.body.endDate ?? null,
          createIdempotencyKey: input.idempotencyKey,
          createIdempotencyPayloadHash: bodyHash,
        })
        .returning();

      if (!plan) {
        throw new Error("Failed to create plan");
      }

      const [version] = await tx
        .insert(planVersions)
        .values({
          planId: plan.id,
          version: 1,
          scheduleRule: { frequency: "daily" },
          effectiveFrom: input.body.startDate,
          effectiveUntil: null,
          createdAt,
          createIdempotencyKey: input.idempotencyKey,
          createIdempotencyPayloadHash: bodyHash,
        })
        .returning();

      if (!version) {
        throw new Error("Failed to create plan version");
      }

      await tx.insert(planScheduleSlots).values({
        planVersionId: version.id,
        slotKey: "default",
        localTime: input.body.localTime,
      });

      await tx.update(plans).set({ currentVersion: version.id }).where(eq(plans.id, plan.id));

      const createdPlan: PlanSnapshot = {
        id: plan.id,
        owner_id: plan.ownerId,
        student_id: plan.studentId,
        plan_kind: plan.planKind,
        status: plan.status,
        title: plan.title,
        description: plan.description,
        start_date: plan.startDate,
        end_date: plan.endDate,
        current_version: version.id,
      };

      const through = horizonThrough(createdPlan, now);
      const today = toFamilyDate(now);
      const from = createdPlan.start_date > today ? createdPlan.start_date : today;

      let itemsCreated = 0;
      if (from <= through) {
        itemsCreated = await generateHorizonInline(tx, {
          plan: createdPlan,
          version: { id: version.id },
          from,
          through,
        });
      }

      await persistExpiredPastWindow(tx, input.studentId, now);

      await appendAuditEvent(tx, {
        actorId: input.ownerId,
        action: "formal_plan.created",
        resourceType: "plan",
        resourceId: plan.id,
        requestId: input.requestId ?? null,
        idempotencyKey: `audit:plan-created:${input.idempotencyKey}`,
        metadata: { studentId: input.studentId, itemsCreated },
      });

      await appendOutboxEvent(tx, {
        aggregateType: "plan",
        aggregateId: plan.id,
        eventType: "plan.created",
        dedupeKey: `plan.created:${plan.id}`,
        payload: { planId: plan.id, versionId: version.id, studentId: input.studentId },
      });

      return {
        planId: plan.id,
        versionId: version.id,
        localTime: input.body.localTime,
        itemsCreated,
        idempotentReplay: false,
      };
    });
  } catch (error) {
    if (isPostgresUniqueViolation(error)) {
      const [raced] = await db
        .select()
        .from(plans)
        .where(
          and(
            eq(plans.ownerId, input.ownerId),
            eq(plans.studentId, input.studentId),
            eq(plans.createIdempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);

      if (raced) {
        if (raced.createIdempotencyPayloadHash !== bodyHash) {
          throw new ScheduleError(
            "IDEMPOTENCY_CONFLICT",
            "Create plan idempotency payload mismatch",
          );
        }
        return loadCreateReplay(db, raced);
      }
    }
    throw error;
  }
}

export async function editFormalPlan(
  db: Database,
  input: EditFormalPlanInput,
): Promise<EditFormalPlanResult> {
  const now = input.now ?? new Date();
  await requireVerifiedParent(db, input.ownerId);
  await assertPlanOwner(db, input.planId, input.ownerId);

  const bodyHash = hashIdempotencyPayload(input.body);

  const fastReplay = await findEditVersionReplay(db, input.planId, input.idempotencyKey, bodyHash);
  if (fastReplay === "conflict") {
    throw new ScheduleError("IDEMPOTENCY_CONFLICT", "Edit plan idempotency payload mismatch");
  }
  if (fastReplay) {
    return fastReplay;
  }

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM plans WHERE id = ${input.planId} FOR UPDATE`);

    const lockedReplay = await findEditVersionReplay(
      tx,
      input.planId,
      input.idempotencyKey,
      bodyHash,
    );
    if (lockedReplay === "conflict") {
      throw new ScheduleError("IDEMPOTENCY_CONFLICT", "Edit plan idempotency payload mismatch");
    }
    if (lockedReplay) {
      return lockedReplay;
    }

    const [oldPlan] = await tx.select().from(plans).where(eq(plans.id, input.planId)).limit(1);
    if (!oldPlan) {
      throw new ScheduleError("NOT_FOUND", "Plan not found");
    }
    if (oldPlan.ownerId !== input.ownerId) {
      throw new ScheduleError("FORBIDDEN", "Only the plan owner can edit");
    }
    if (oldPlan.status !== "active") {
      throw new ScheduleError("STATE_CONFLICT", "Plan is not active");
    }
    if (!oldPlan.currentVersion) {
      throw new ScheduleError("STATE_CONFLICT", "Plan is missing current version");
    }

    const oldVersionId = oldPlan.currentVersion;

    const inheritedLocalTime = await loadPlanVersionSlotLocalTime(tx, oldVersionId);
    if (!inheritedLocalTime) {
      throw new ScheduleError("SLOT_INVARIANT", "Old plan version slot missing");
    }

    const slotTime =
      input.body.localTime === undefined || input.body.localTime === null
        ? inheritedLocalTime
        : input.body.localTime;

    const effectiveEndDate =
      input.body.endDate === undefined || input.body.endDate === null
        ? oldPlan.endDate
        : input.body.endDate;

    const effectiveTitle =
      input.body.title === undefined || input.body.title === null
        ? oldPlan.title
        : input.body.title;

    const effectiveDescription =
      input.body.description === undefined || input.body.description === null
        ? oldPlan.description
        : input.body.description;

    const [oldVersion] = await tx
      .select({ version: planVersions.version })
      .from(planVersions)
      .where(eq(planVersions.id, oldVersionId))
      .limit(1);

    if (!oldVersion) {
      throw new ScheduleError("NOT_FOUND", "Current plan version not found");
    }

    const effectiveFrom = nextFamilyDate(now);

    const [newVersion] = await tx
      .insert(planVersions)
      .values({
        planId: oldPlan.id,
        version: oldVersion.version + 1,
        scheduleRule: { frequency: "daily" },
        effectiveFrom,
        effectiveUntil: null,
        createdAt: now,
        createIdempotencyKey: input.idempotencyKey,
        createIdempotencyPayloadHash: bodyHash,
      })
      .returning();

    if (!newVersion) {
      throw new Error("Failed to create plan version");
    }

    await tx.insert(planScheduleSlots).values({
      planVersionId: newVersion.id,
      slotKey: "default",
      localTime: slotTime,
    });

    await tx
      .update(plans)
      .set({
        title: effectiveTitle,
        description: effectiveDescription,
        endDate: effectiveEndDate,
        currentVersion: newVersion.id,
      })
      .where(eq(plans.id, oldPlan.id));

    const updatedPlan: PlanSnapshot = {
      id: oldPlan.id,
      owner_id: oldPlan.ownerId,
      student_id: oldPlan.studentId,
      plan_kind: oldPlan.planKind,
      status: oldPlan.status,
      title: effectiveTitle,
      description: effectiveDescription,
      start_date: oldPlan.startDate,
      end_date: effectiveEndDate,
      current_version: newVersion.id,
    };

    await cancelPendingAfterEndDate(tx, oldPlan.studentId, effectiveEndDate);

    await tx.execute(sql`
      UPDATE schedule_items
      SET status = 'cancelled'
      WHERE plan_version_id = ${oldVersionId}::uuid
        AND status = 'pending'
        AND family_date >= ${effectiveFrom}::date
    `);

    const through = horizonThrough(updatedPlan, now);
    const from = effectiveFrom;

    let itemsCreated = 0;
    if (from <= through) {
      itemsCreated = await generateHorizonInline(tx, {
        plan: updatedPlan,
        version: { id: newVersion.id },
        from,
        through,
      });
    }

    await persistExpiredPastWindow(tx, oldPlan.studentId, now);

    await appendAuditEvent(tx, {
      actorId: input.ownerId,
      action: "formal_plan.version_created",
      resourceType: "plan_version",
      resourceId: newVersion.id,
      requestId: input.requestId ?? null,
      idempotencyKey: `audit:plan-version-created:${input.idempotencyKey}`,
      metadata: { planId: oldPlan.id, version: newVersion.version, itemsCreated },
    });

    await appendOutboxEvent(tx, {
      aggregateType: "plan",
      aggregateId: oldPlan.id,
      eventType: "plan.version_created",
      dedupeKey: `plan.version_created:${newVersion.id}`,
      payload: { planId: oldPlan.id, versionId: newVersion.id, studentId: oldPlan.studentId },
    });

    return {
      planId: oldPlan.id,
      versionId: newVersion.id,
      localTime: slotTime,
      itemsCreated,
      idempotentReplay: false,
    };
  });
}

export async function deactivateFormalPlan(
  db: Database,
  input: DeactivateFormalPlanInput,
): Promise<DeactivateFormalPlanResult> {
  const now = input.now ?? new Date();
  await requireVerifiedParent(db, input.ownerId);
  await assertPlanOwner(db, input.planId, input.ownerId);

  const bodyHash = hashIdempotencyPayload({});

  const [preflightPlan] = await db.select().from(plans).where(eq(plans.id, input.planId)).limit(1);
  if (!preflightPlan) {
    throw new ScheduleError("NOT_FOUND", "Plan not found");
  }

  const fastReplay = findDeactivateReplay(preflightPlan, input.idempotencyKey, bodyHash);
  if (fastReplay === "conflict") {
    throw new ScheduleError("IDEMPOTENCY_CONFLICT", "Deactivate plan idempotency payload mismatch");
  }
  if (fastReplay) {
    return fastReplay;
  }

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM plans WHERE id = ${input.planId} FOR UPDATE`);

    const [plan] = await tx.select().from(plans).where(eq(plans.id, input.planId)).limit(1);
    if (!plan) {
      throw new ScheduleError("NOT_FOUND", "Plan not found");
    }
    if (plan.ownerId !== input.ownerId) {
      throw new ScheduleError("FORBIDDEN", "Only the plan owner can deactivate");
    }

    const lockedReplay = findDeactivateReplay(plan, input.idempotencyKey, bodyHash);
    if (lockedReplay === "conflict") {
      throw new ScheduleError(
        "IDEMPOTENCY_CONFLICT",
        "Deactivate plan idempotency payload mismatch",
      );
    }
    if (lockedReplay) {
      return lockedReplay;
    }

    if (plan.status === "inactive") {
      throw new ScheduleError("STATE_CONFLICT", "Plan is already inactive");
    }

    const today = toFamilyDate(now);

    await tx
      .update(plans)
      .set({
        status: "inactive",
        deactivateIdempotencyKey: input.idempotencyKey,
        deactivateIdempotencyPayloadHash: bodyHash,
      })
      .where(eq(plans.id, plan.id));

    await tx.execute(sql`
      UPDATE schedule_items
      SET status = 'cancelled'
      WHERE plan_id = ${plan.id}::uuid
        AND status = 'pending'
        AND family_date >= ${today}::date
    `);

    await persistExpiredPastWindow(tx, plan.studentId, now);

    await appendAuditEvent(tx, {
      actorId: input.ownerId,
      action: "formal_plan.deactivated",
      resourceType: "plan",
      resourceId: plan.id,
      requestId: input.requestId ?? null,
      idempotencyKey: `audit:plan-deactivated:${input.idempotencyKey}`,
      metadata: { studentId: plan.studentId },
    });

    await appendOutboxEvent(tx, {
      aggregateType: "plan",
      aggregateId: plan.id,
      eventType: "plan.deactivated",
      dedupeKey: `plan.deactivated:${plan.id}`,
      payload: { planId: plan.id, studentId: plan.studentId },
    });

    return {
      planId: plan.id,
      status: "inactive",
      idempotentReplay: false,
    };
  });
}

export { toPlanSnapshot };
