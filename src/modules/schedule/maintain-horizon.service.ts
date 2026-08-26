import { and, eq, max, sql } from "drizzle-orm";

import type { Database } from "@/db";
import { planVersions, plans, scheduleHorizonMaintains, scheduleItems } from "@/db/schema";
import { appendAuditEvent } from "@/modules/audit/append-audit-event";
import { requireActiveRelationship } from "@/modules/family-access/authorization.service";
import { FamilyAccessError } from "@/modules/family-access/errors";
import { appendOutboxEvent } from "@/modules/outbox/append-outbox-event";
import { generateHorizonInline } from "@/modules/schedule/generate-horizon-inline.service";
import { hashIdempotencyPayload } from "@/modules/schedule/normalize-idempotency-payload";
import { persistExpiredPastWindow } from "@/modules/schedule/persist-expired.service";
import { toPlanSnapshot } from "@/modules/schedule/plan.service";
import { ScheduleError } from "@/modules/schedule/errors";
import { addFamilyDays } from "@/modules/time-policy/add-family-days";
import { horizonThrough } from "@/modules/time-policy/horizon-through";
import { toFamilyDate } from "@/modules/time-policy/to-family-date";
import { users } from "@/db/schema";

export type MaintainHorizonInput = {
  actorId: string;
  studentId: string;
  idempotencyKey: string;
  now?: Date;
  requestId?: string;
};

export type MaintainHorizonResult = {
  maintainId: string;
  itemsCreated: number;
  idempotentReplay: boolean;
};

async function requireVerifiedParent(db: Database, parentId: string) {
  const [parent] = await db.select().from(users).where(eq(users.id, parentId)).limit(1);
  if (!parent) {
    throw new ScheduleError("NOT_FOUND", "Parent not found");
  }
  if (parent.role !== "parent") {
    throw new ScheduleError("FORBIDDEN", "Only parents can maintain schedule horizon");
  }
  if (!parent.contactVerifiedAt) {
    throw new ScheduleError("FORBIDDEN", "Parent contact must be verified");
  }
}

async function findMaintainRow(
  db: Database,
  studentId: string,
  actorId: string,
  idempotencyKey: string,
) {
  const [row] = await db
    .select()
    .from(scheduleHorizonMaintains)
    .where(
      and(
        eq(scheduleHorizonMaintains.studentId, studentId),
        eq(scheduleHorizonMaintains.actorId, actorId),
        eq(scheduleHorizonMaintains.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);

  return row ?? null;
}

function computeMaintainFrom(maxPendingDate: string | null | undefined, today: string): string {
  if (!maxPendingDate) {
    return today;
  }

  const next = addFamilyDays(maxPendingDate, 1);
  return next > today ? next : today;
}

function replayResult(row: typeof scheduleHorizonMaintains.$inferSelect): MaintainHorizonResult {
  return {
    maintainId: row.id,
    itemsCreated: row.itemsCreated,
    idempotentReplay: true,
  };
}

export async function maintainHorizon(
  db: Database,
  input: MaintainHorizonInput,
): Promise<MaintainHorizonResult> {
  const now = input.now ?? new Date();
  await requireVerifiedParent(db, input.actorId);

  try {
    await requireActiveRelationship(db, input.actorId, input.studentId);
  } catch (error) {
    if (error instanceof FamilyAccessError && error.code === "FORBIDDEN") {
      throw new ScheduleError("FORBIDDEN", error.message);
    }
    throw error;
  }

  const bodyHash = hashIdempotencyPayload({});

  const existing = await findMaintainRow(db, input.studentId, input.actorId, input.idempotencyKey);
  if (existing) {
    if (existing.idempotencyPayloadHash !== bodyHash) {
      throw new ScheduleError(
        "IDEMPOTENCY_CONFLICT",
        "Maintain horizon idempotency payload mismatch",
      );
    }
    return replayResult(existing);
  }

  return db.transaction(async (tx) => {
    const existingInTx = await findMaintainRow(
      tx,
      input.studentId,
      input.actorId,
      input.idempotencyKey,
    );
    if (existingInTx) {
      if (existingInTx.idempotencyPayloadHash !== bodyHash) {
        throw new ScheduleError(
          "IDEMPOTENCY_CONFLICT",
          "Maintain horizon idempotency payload mismatch",
        );
      }
      return replayResult(existingInTx);
    }

    await tx.execute(sql`
      SELECT id FROM plans
      WHERE student_id = ${input.studentId}::uuid
        AND plan_kind = 'formal'
        AND status = 'active'
      FOR UPDATE
    `);

    const [plan] = await tx
      .select()
      .from(plans)
      .where(
        and(
          eq(plans.studentId, input.studentId),
          eq(plans.planKind, "formal"),
          eq(plans.status, "active"),
        ),
      )
      .limit(1);

    if (!plan || !plan.currentVersion) {
      throw new ScheduleError("NOT_FOUND", "Active formal plan not found");
    }

    const [version] = await tx
      .select()
      .from(planVersions)
      .where(eq(planVersions.id, plan.currentVersion))
      .limit(1);

    if (!version) {
      throw new ScheduleError("NOT_FOUND", "Current plan version not found");
    }

    const [placeholder] = await tx
      .insert(scheduleHorizonMaintains)
      .values({
        studentId: input.studentId,
        actorId: input.actorId,
        idempotencyKey: input.idempotencyKey,
        idempotencyPayloadHash: bodyHash,
        itemsCreated: 0,
        createdAt: now,
      })
      .onConflictDoNothing({
        target: [
          scheduleHorizonMaintains.studentId,
          scheduleHorizonMaintains.actorId,
          scheduleHorizonMaintains.idempotencyKey,
        ],
      })
      .returning();

    if (!placeholder) {
      const raced = await findMaintainRow(tx, input.studentId, input.actorId, input.idempotencyKey);
      if (!raced) {
        throw new Error("Maintain horizon placeholder conflict without existing row");
      }
      if (raced.idempotencyPayloadHash !== bodyHash) {
        throw new ScheduleError(
          "IDEMPOTENCY_CONFLICT",
          "Maintain horizon idempotency payload mismatch",
        );
      }
      return replayResult(raced);
    }

    await persistExpiredPastWindow(tx, input.studentId, now);

    const planSnapshot = toPlanSnapshot(plan);
    const today = toFamilyDate(now);
    const through = horizonThrough(planSnapshot, now);

    let itemsCreated = 0;
    if (plan.endDate == null || today <= plan.endDate) {
      const [maxRow] = await tx
        .select({ maxDate: max(scheduleItems.familyDate) })
        .from(scheduleItems)
        .where(
          and(
            eq(scheduleItems.planVersionId, plan.currentVersion),
            eq(scheduleItems.status, "pending"),
          ),
        );

      const from = computeMaintainFrom(maxRow?.maxDate ?? null, today);
      if (from <= through) {
        itemsCreated = await generateHorizonInline(tx, {
          plan: planSnapshot,
          version: { id: version.id },
          from,
          through,
        });
      }
    }

    await tx
      .update(scheduleHorizonMaintains)
      .set({ itemsCreated })
      .where(eq(scheduleHorizonMaintains.id, placeholder.id));

    if (itemsCreated > 0) {
      await appendAuditEvent(tx, {
        actorId: input.actorId,
        action: "schedule.horizon_maintained",
        resourceType: "student",
        resourceId: input.studentId,
        requestId: input.requestId ?? null,
        idempotencyKey: `audit:horizon-maintained:${input.idempotencyKey}`,
        metadata: { maintainId: placeholder.id, itemsCreated },
      });

      await appendOutboxEvent(tx, {
        aggregateType: "student",
        aggregateId: input.studentId,
        eventType: "schedule.horizon_maintained",
        dedupeKey: `schedule.horizon_maintained:${placeholder.id}`,
        payload: {
          maintainId: placeholder.id,
          studentId: input.studentId,
          itemsCreated,
        },
      });
    }

    return {
      maintainId: placeholder.id,
      itemsCreated,
      idempotentReplay: false,
    };
  });
}
