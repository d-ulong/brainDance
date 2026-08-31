import { and, eq, inArray, sql } from "drizzle-orm";

import type { Database } from "@/db";
import { auditEvents, pointRedemptions, redemptionCatalogItems } from "@/db/schema";
import { appendAuditEvent } from "@/modules/audit/append-audit-event";
import { requireActiveRelationship } from "@/modules/family-access/authorization.service";
import { appendOutboxEvent } from "@/modules/outbox/append-outbox-event";
import { isPostgresUniqueViolation } from "@/lib/postgres-errors";
import { appendLedgerForRedemption } from "@/modules/redemption/ledger-redemption.service";
import { lockStudentBalanceThenMonthlyUsage } from "@/modules/redemption/approve-lock-order";
import { RedemptionError } from "@/modules/redemption/errors";
import { toFamilyMonth } from "@/modules/redemption/to-family-month";
import { hashIdempotencyPayload } from "@/modules/schedule/normalize-idempotency-payload";

export type RedemptionDto = {
  id: string;
  studentId: string;
  catalogItemId: string;
  costSnapshot: number;
  requestMonth: string;
  status: string;
  requestedAt: Date;
  confirmedAt: Date | null;
  confirmedBy: string | null;
  rejectionReason: string | null;
  ledgerEntryId: string | null;
};

function toRedemptionDto(row: typeof pointRedemptions.$inferSelect): RedemptionDto {
  return {
    id: row.id,
    studentId: row.studentId,
    catalogItemId: row.catalogItemId,
    costSnapshot: row.costSnapshot,
    requestMonth: row.requestMonth,
    status: row.status,
    requestedAt: row.requestedAt,
    confirmedAt: row.confirmedAt,
    confirmedBy: row.confirmedBy,
    rejectionReason: row.rejectionReason,
    ledgerEntryId: row.ledgerEntryId,
  };
}

async function lockRedemptionRow(tx: Database, redemptionId: string) {
  await tx.execute(
    sql`SELECT id FROM point_redemptions WHERE id = ${redemptionId}::uuid FOR UPDATE`,
  );

  const [row] = await tx
    .select()
    .from(pointRedemptions)
    .where(eq(pointRedemptions.id, redemptionId))
    .limit(1);

  if (!row) {
    throw new RedemptionError("NOT_FOUND", "Redemption request not found");
  }

  return row;
}

async function lockMonthlyRedemptions(
  tx: Database,
  catalogItemId: string,
  requestMonth: string,
): Promise<Array<typeof pointRedemptions.$inferSelect>> {
  return tx
    .select()
    .from(pointRedemptions)
    .where(
      and(
        eq(pointRedemptions.catalogItemId, catalogItemId),
        eq(pointRedemptions.requestMonth, requestMonth),
        inArray(pointRedemptions.status, ["pending", "approved"]),
      ),
    )
    .for("update");
}

async function countMonthlyUsage(
  rows: Array<typeof pointRedemptions.$inferSelect>,
): Promise<number> {
  return rows.length;
}

function readStoredPayloadHash(metadata: unknown): string | undefined {
  if (!metadata || typeof metadata !== "object") {
    return undefined;
  }
  const value = (metadata as { payloadHash?: unknown }).payloadHash;
  return typeof value === "string" ? value : undefined;
}

async function findCommandReplay(
  db: Database,
  auditKey: string,
  resourceId: string,
  expectedPayloadHash: string,
): Promise<boolean> {
  const [existing] = await db
    .select({ resourceId: auditEvents.resourceId, metadata: auditEvents.metadata })
    .from(auditEvents)
    .where(eq(auditEvents.idempotencyKey, auditKey))
    .limit(1);

  if (!existing?.resourceId) {
    return false;
  }

  if (existing.resourceId !== resourceId) {
    throw new RedemptionError("IDEMPOTENCY_CONFLICT", "Redemption command idempotency conflict");
  }

  const storedHash = readStoredPayloadHash(existing.metadata);
  if (storedHash !== expectedPayloadHash) {
    throw new RedemptionError("IDEMPOTENCY_CONFLICT", "Redemption command idempotency conflict");
  }

  return true;
}

export type CreateRedemptionInput = {
  studentId: string;
  actorId: string;
  catalogItemId: string;
  idempotencyKey: string;
  now?: Date;
  requestId?: string;
};

export type CreateRedemptionResult = {
  redemption: RedemptionDto;
  idempotentReplay: boolean;
};

export async function createRedemptionRequest(
  db: Database,
  input: CreateRedemptionInput,
): Promise<CreateRedemptionResult> {
  if (input.actorId !== input.studentId) {
    throw new RedemptionError("FORBIDDEN", "Only the student can create redemption requests");
  }

  const payload = { catalogItemId: input.catalogItemId };
  const payloadHash = hashIdempotencyPayload(payload);
  const now = input.now ?? new Date();
  const requestMonth = toFamilyMonth(now);

  const [existing] = await db
    .select()
    .from(pointRedemptions)
    .where(
      and(
        eq(pointRedemptions.studentId, input.studentId),
        eq(pointRedemptions.createIdempotencyKey, input.idempotencyKey),
      ),
    )
    .limit(1);

  if (existing) {
    if (existing.createIdempotencyPayloadHash !== payloadHash) {
      throw new RedemptionError("IDEMPOTENCY_CONFLICT", "Redemption request idempotency conflict");
    }
    return { redemption: toRedemptionDto(existing), idempotentReplay: true };
  }

  return db.transaction(async (tx) => {
    const [replay] = await tx
      .select()
      .from(pointRedemptions)
      .where(
        and(
          eq(pointRedemptions.studentId, input.studentId),
          eq(pointRedemptions.createIdempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);

    if (replay) {
      if (replay.createIdempotencyPayloadHash !== payloadHash) {
        throw new RedemptionError(
          "IDEMPOTENCY_CONFLICT",
          "Redemption request idempotency conflict",
        );
      }
      return { redemption: toRedemptionDto(replay), idempotentReplay: true };
    }

    const [catalogItem] = await tx
      .select()
      .from(redemptionCatalogItems)
      .where(
        and(
          eq(redemptionCatalogItems.id, input.catalogItemId),
          eq(redemptionCatalogItems.studentId, input.studentId),
        ),
      )
      .limit(1);

    if (!catalogItem) {
      throw new RedemptionError("NOT_FOUND", "Catalog item not found");
    }

    if (!catalogItem.active) {
      throw new RedemptionError("CATALOG_INACTIVE", "Catalog item is not active");
    }

    if (catalogItem.monthlyLimit != null) {
      const monthlyRows = await lockMonthlyRedemptions(tx, catalogItem.id, requestMonth);
      if ((await countMonthlyUsage(monthlyRows)) >= catalogItem.monthlyLimit) {
        throw new RedemptionError("MONTHLY_LIMIT_EXCEEDED", "Monthly redemption limit exceeded");
      }
    }

    try {
      const [inserted] = await tx
        .insert(pointRedemptions)
        .values({
          studentId: input.studentId,
          catalogItemId: catalogItem.id,
          costSnapshot: catalogItem.cost,
          requestMonth,
          status: "pending",
          requestedAt: now,
          confirmedAt: null,
          confirmedBy: null,
          rejectionReason: null,
          ledgerEntryId: null,
          createIdempotencyKey: input.idempotencyKey,
          createIdempotencyPayloadHash: payloadHash,
          createdAt: now,
        })
        .returning();

      if (!inserted) {
        throw new RedemptionError("STATE_CONFLICT", "Failed to create redemption request");
      }

      await appendAuditEvent(tx, {
        actorId: input.actorId,
        action: "point_redemption.requested",
        resourceType: "point_redemption",
        resourceId: inserted.id,
        requestId: input.requestId ?? null,
        idempotencyKey: `audit:redemption-requested:${input.idempotencyKey}`,
        metadata: {
          catalogItemId: catalogItem.id,
          costSnapshot: catalogItem.cost,
          requestMonth,
        },
      });

      await appendOutboxEvent(tx, {
        aggregateType: "point_redemption",
        aggregateId: inserted.id,
        eventType: "point_redemption.requested",
        dedupeKey: `point_redemption.requested:${input.idempotencyKey}`,
        payload: {
          schemaVersion: 1,
          redemptionId: inserted.id,
          studentId: input.studentId,
          catalogItemId: catalogItem.id,
          costSnapshot: catalogItem.cost,
        },
      });

      return { redemption: toRedemptionDto(inserted), idempotentReplay: false };
    } catch (error) {
      if (isPostgresUniqueViolation(error)) {
        const [raceReplay] = await tx
          .select()
          .from(pointRedemptions)
          .where(
            and(
              eq(pointRedemptions.studentId, input.studentId),
              eq(pointRedemptions.createIdempotencyKey, input.idempotencyKey),
            ),
          )
          .limit(1);

        if (raceReplay) {
          if (raceReplay.createIdempotencyPayloadHash !== payloadHash) {
            throw new RedemptionError(
              "IDEMPOTENCY_CONFLICT",
              "Redemption request idempotency conflict",
            );
          }
          return { redemption: toRedemptionDto(raceReplay), idempotentReplay: true };
        }
      }
      throw error;
    }
  });
}

export type CancelRedemptionInput = {
  studentId: string;
  actorId: string;
  redemptionId: string;
  idempotencyKey: string;
  now?: Date;
  requestId?: string;
};

export type TerminalRedemptionResult = {
  redemption: RedemptionDto;
  idempotentReplay: boolean;
};

export async function cancelRedemptionRequest(
  db: Database,
  input: CancelRedemptionInput,
): Promise<TerminalRedemptionResult> {
  if (input.actorId !== input.studentId) {
    throw new RedemptionError("FORBIDDEN", "Only the student can cancel redemption requests");
  }

  const auditKey = `audit:redemption-cancelled:${input.idempotencyKey}`;
  const cancelPayloadHash = hashIdempotencyPayload({ redemptionId: input.redemptionId });
  const replay = await findCommandReplay(db, auditKey, input.redemptionId, cancelPayloadHash);
  if (replay) {
    const [row] = await db
      .select()
      .from(pointRedemptions)
      .where(eq(pointRedemptions.id, input.redemptionId))
      .limit(1);
    if (!row) {
      throw new RedemptionError("NOT_FOUND", "Redemption request not found");
    }
    return { redemption: toRedemptionDto(row), idempotentReplay: true };
  }

  const now = input.now ?? new Date();

  return db.transaction(async (tx) => {
    if (await findCommandReplay(tx, auditKey, input.redemptionId, cancelPayloadHash)) {
      const [row] = await tx
        .select()
        .from(pointRedemptions)
        .where(eq(pointRedemptions.id, input.redemptionId))
        .limit(1);
      if (!row) {
        throw new RedemptionError("NOT_FOUND", "Redemption request not found");
      }
      return { redemption: toRedemptionDto(row), idempotentReplay: true };
    }

    const row = await lockRedemptionRow(tx, input.redemptionId);

    if (row.studentId !== input.studentId) {
      throw new RedemptionError("NOT_FOUND", "Redemption request not found");
    }

    if (row.status !== "pending") {
      throw new RedemptionError("STATE_CONFLICT", "Redemption request is not pending");
    }

    const [updated] = await tx
      .update(pointRedemptions)
      .set({
        status: "cancelled",
        confirmedAt: now,
        confirmedBy: input.actorId,
      })
      .where(
        and(eq(pointRedemptions.id, input.redemptionId), eq(pointRedemptions.status, "pending")),
      )
      .returning();

    if (!updated) {
      throw new RedemptionError("STATE_CONFLICT", "Redemption request is not pending");
    }

    await appendAuditEvent(tx, {
      actorId: input.actorId,
      action: "point_redemption.cancelled",
      resourceType: "point_redemption",
      resourceId: input.redemptionId,
      requestId: input.requestId ?? null,
      idempotencyKey: auditKey,
      metadata: { studentId: input.studentId, payloadHash: cancelPayloadHash },
    });

    await appendOutboxEvent(tx, {
      aggregateType: "point_redemption",
      aggregateId: input.redemptionId,
      eventType: "point_redemption.cancelled",
      dedupeKey: `point_redemption.cancelled:${input.idempotencyKey}`,
      payload: { schemaVersion: 1, redemptionId: input.redemptionId },
    });

    return { redemption: toRedemptionDto(updated), idempotentReplay: false };
  });
}

export type ApproveRedemptionInput = {
  parentId: string;
  studentId: string;
  redemptionId: string;
  idempotencyKey: string;
  now?: Date;
  requestId?: string;
};

export async function approveRedemptionRequest(
  db: Database,
  input: ApproveRedemptionInput,
): Promise<TerminalRedemptionResult> {
  await requireActiveRelationship(db, input.parentId, input.studentId);

  const auditKey = `audit:redemption-approved:${input.idempotencyKey}`;
  const approvePayloadHash = hashIdempotencyPayload({ redemptionId: input.redemptionId });
  const replay = await findCommandReplay(db, auditKey, input.redemptionId, approvePayloadHash);
  if (replay) {
    const [row] = await db
      .select()
      .from(pointRedemptions)
      .where(eq(pointRedemptions.id, input.redemptionId))
      .limit(1);
    if (!row) {
      throw new RedemptionError("NOT_FOUND", "Redemption request not found");
    }
    return { redemption: toRedemptionDto(row), idempotentReplay: true };
  }

  const now = input.now ?? new Date();

  return db.transaction(async (tx) => {
    if (await findCommandReplay(tx, auditKey, input.redemptionId, approvePayloadHash)) {
      const [row] = await tx
        .select()
        .from(pointRedemptions)
        .where(eq(pointRedemptions.id, input.redemptionId))
        .limit(1);
      if (!row) {
        throw new RedemptionError("NOT_FOUND", "Redemption request not found");
      }
      return { redemption: toRedemptionDto(row), idempotentReplay: true };
    }

    // Frozen lock order: redemption row → student/balance → monthly usage rows.
    const row = await lockRedemptionRow(tx, input.redemptionId);

    if (row.studentId !== input.studentId) {
      throw new RedemptionError("NOT_FOUND", "Redemption request not found");
    }

    if (row.status !== "pending") {
      throw new RedemptionError("STATE_CONFLICT", "Redemption request is not pending");
    }

    const [catalogItem] = await tx
      .select()
      .from(redemptionCatalogItems)
      .where(eq(redemptionCatalogItems.id, row.catalogItemId))
      .limit(1);

    if (!catalogItem?.active) {
      throw new RedemptionError("CATALOG_INACTIVE", "Catalog item is not active");
    }

    await requireActiveRelationship(tx, input.parentId, input.studentId);

    const { balance } = await lockStudentBalanceThenMonthlyUsage(tx, {
      studentId: input.studentId,
      catalogItemId: catalogItem.id,
      requestMonth: row.requestMonth,
      monthlyLimit: catalogItem.monthlyLimit,
      lockMonthlyRows: lockMonthlyRedemptions,
      countMonthlyUsage,
    });
    if (balance < 0) {
      throw new RedemptionError("INSUFFICIENT_BALANCE", "Balance is negative");
    }
    if (balance < row.costSnapshot) {
      throw new RedemptionError("INSUFFICIENT_BALANCE", "Insufficient points balance");
    }

    const ledger = await appendLedgerForRedemption(tx, {
      studentId: input.studentId,
      redemptionId: input.redemptionId,
      amount: -row.costSnapshot,
      actorId: input.parentId,
      idempotencyKey: `ledger:redemption:${input.redemptionId}`,
      now,
    });

    const [updated] = await tx
      .update(pointRedemptions)
      .set({
        status: "approved",
        confirmedAt: now,
        confirmedBy: input.parentId,
        ledgerEntryId: ledger.ledgerEntryId,
      })
      .where(
        and(eq(pointRedemptions.id, input.redemptionId), eq(pointRedemptions.status, "pending")),
      )
      .returning();

    if (!updated) {
      throw new RedemptionError("STATE_CONFLICT", "Redemption request is not pending");
    }

    await appendAuditEvent(tx, {
      actorId: input.parentId,
      action: "point_redemption.approved",
      resourceType: "point_redemption",
      resourceId: input.redemptionId,
      requestId: input.requestId ?? null,
      idempotencyKey: auditKey,
      metadata: {
        studentId: input.studentId,
        ledgerEntryId: ledger.ledgerEntryId,
        costSnapshot: row.costSnapshot,
        payloadHash: approvePayloadHash,
      },
    });

    return { redemption: toRedemptionDto(updated), idempotentReplay: false };
  });
}

export type RejectRedemptionInput = {
  parentId: string;
  studentId: string;
  redemptionId: string;
  reason: string;
  idempotencyKey: string;
  now?: Date;
  requestId?: string;
};

export async function rejectRedemptionRequest(
  db: Database,
  input: RejectRedemptionInput,
): Promise<TerminalRedemptionResult> {
  await requireActiveRelationship(db, input.parentId, input.studentId);

  const trimmedReason = input.reason.trim();
  if (!trimmedReason) {
    throw new RedemptionError("VALIDATION_ERROR", "Rejection reason is required");
  }

  const auditKey = `audit:redemption-rejected:${input.idempotencyKey}`;
  const rejectPayloadHash = hashIdempotencyPayload({
    redemptionId: input.redemptionId,
    reason: trimmedReason,
  });
  const replay = await findCommandReplay(db, auditKey, input.redemptionId, rejectPayloadHash);
  if (replay) {
    const [row] = await db
      .select()
      .from(pointRedemptions)
      .where(eq(pointRedemptions.id, input.redemptionId))
      .limit(1);
    if (!row) {
      throw new RedemptionError("NOT_FOUND", "Redemption request not found");
    }
    return { redemption: toRedemptionDto(row), idempotentReplay: true };
  }

  const now = input.now ?? new Date();

  return db.transaction(async (tx) => {
    if (await findCommandReplay(tx, auditKey, input.redemptionId, rejectPayloadHash)) {
      const [row] = await tx
        .select()
        .from(pointRedemptions)
        .where(eq(pointRedemptions.id, input.redemptionId))
        .limit(1);
      if (!row) {
        throw new RedemptionError("NOT_FOUND", "Redemption request not found");
      }
      return { redemption: toRedemptionDto(row), idempotentReplay: true };
    }

    const row = await lockRedemptionRow(tx, input.redemptionId);

    if (row.studentId !== input.studentId) {
      throw new RedemptionError("NOT_FOUND", "Redemption request not found");
    }

    if (row.status !== "pending") {
      throw new RedemptionError("STATE_CONFLICT", "Redemption request is not pending");
    }

    await requireActiveRelationship(tx, input.parentId, input.studentId);

    const [updated] = await tx
      .update(pointRedemptions)
      .set({
        status: "rejected",
        confirmedAt: now,
        confirmedBy: input.parentId,
        rejectionReason: trimmedReason,
      })
      .where(
        and(eq(pointRedemptions.id, input.redemptionId), eq(pointRedemptions.status, "pending")),
      )
      .returning();

    if (!updated) {
      throw new RedemptionError("STATE_CONFLICT", "Redemption request is not pending");
    }

    await appendAuditEvent(tx, {
      actorId: input.parentId,
      action: "point_redemption.rejected",
      resourceType: "point_redemption",
      resourceId: input.redemptionId,
      requestId: input.requestId ?? null,
      idempotencyKey: auditKey,
      metadata: {
        studentId: input.studentId,
        reason: trimmedReason,
        payloadHash: rejectPayloadHash,
      },
    });

    await appendOutboxEvent(tx, {
      aggregateType: "point_redemption",
      aggregateId: input.redemptionId,
      eventType: "point_redemption.rejected",
      dedupeKey: `point_redemption.rejected:${input.idempotencyKey}`,
      payload: { schemaVersion: 1, redemptionId: input.redemptionId },
    });

    return { redemption: toRedemptionDto(updated), idempotentReplay: false };
  });
}

export async function listRedemptions(db: Database, studentId: string): Promise<RedemptionDto[]> {
  const rows = await db
    .select()
    .from(pointRedemptions)
    .where(eq(pointRedemptions.studentId, studentId));

  return rows.map(toRedemptionDto);
}

export function sanitizeRedemptionForStudent(dto: RedemptionDto): RedemptionDto {
  return dto;
}

export function sanitizeRedemptionForParent(dto: RedemptionDto): RedemptionDto {
  return dto;
}
