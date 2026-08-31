import { and, eq } from "drizzle-orm";

import type { Database } from "@/db";
import { auditEvents, redemptionCatalogItems, users } from "@/db/schema";
import { requireActiveRelationship } from "@/modules/family-access/authorization.service";
import { assertStudentAccountNotFrozen } from "@/modules/data-lifecycle/freeze-guard.service";
import { hashIdempotencyPayload } from "@/modules/schedule/normalize-idempotency-payload";
import { RedemptionError } from "@/modules/redemption/errors";
import { appendAuditEvent } from "@/modules/audit/append-audit-event";
import { appendOutboxEvent } from "@/modules/outbox/append-outbox-event";

export type CatalogItemDto = {
  id: string;
  studentId: string;
  creatorParentId: string;
  title: string;
  description: string | null;
  cost: number;
  monthlyLimit: number | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function toCatalogDto(row: typeof redemptionCatalogItems.$inferSelect): CatalogItemDto {
  return {
    id: row.id,
    studentId: row.studentId,
    creatorParentId: row.creatorParentId,
    title: row.title,
    description: row.description,
    cost: row.cost,
    monthlyLimit: row.monthlyLimit,
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function readStoredPayloadHash(metadata: unknown): string | undefined {
  if (!metadata || typeof metadata !== "object") {
    return undefined;
  }
  const value = (metadata as { payloadHash?: unknown }).payloadHash;
  return typeof value === "string" ? value : undefined;
}

async function requireVerifiedParent(db: Database, parentId: string) {
  const [parent] = await db.select().from(users).where(eq(users.id, parentId)).limit(1);
  if (!parent) {
    throw new RedemptionError("NOT_FOUND", "Parent not found");
  }
  if (parent.role !== "parent") {
    throw new RedemptionError("FORBIDDEN", "Only parents can manage redemption catalog");
  }
  if (!parent.contactVerifiedAt) {
    throw new RedemptionError("FORBIDDEN", "Parent contact must be verified");
  }
  return parent;
}

export type CreateCatalogItemInput = {
  parentId: string;
  studentId: string;
  idempotencyKey: string;
  body: {
    title: string;
    description?: string | null;
    cost: number;
    monthlyLimit?: number | null;
  };
  now?: Date;
  requestId?: string;
};

export type CreateCatalogItemResult = {
  item: CatalogItemDto;
  idempotentReplay: boolean;
};

export async function createCatalogItem(
  db: Database,
  input: CreateCatalogItemInput,
): Promise<CreateCatalogItemResult> {
  await requireVerifiedParent(db, input.parentId);
  await requireActiveRelationship(db, input.parentId, input.studentId);
  await assertStudentAccountNotFrozen(db, input.studentId, "write");

  const payloadHash = hashIdempotencyPayload(input.body);
  const now = input.now ?? new Date();

  const [existing] = await db
    .select()
    .from(redemptionCatalogItems)
    .where(
      and(
        eq(redemptionCatalogItems.creatorParentId, input.parentId),
        eq(redemptionCatalogItems.createIdempotencyKey, input.idempotencyKey),
      ),
    )
    .limit(1);

  if (existing) {
    if (existing.createIdempotencyPayloadHash !== payloadHash) {
      throw new RedemptionError("IDEMPOTENCY_CONFLICT", "Catalog item idempotency conflict");
    }
    return { item: toCatalogDto(existing), idempotentReplay: true };
  }

  if (!Number.isInteger(input.body.cost) || input.body.cost <= 0) {
    throw new RedemptionError("VALIDATION_ERROR", "Cost must be a positive integer");
  }

  if (input.body.monthlyLimit != null) {
    if (!Number.isInteger(input.body.monthlyLimit) || input.body.monthlyLimit <= 0) {
      throw new RedemptionError("VALIDATION_ERROR", "Monthly limit must be a positive integer");
    }
  }

  return db.transaction(async (tx) => {
    const [existingInTx] = await tx
      .select()
      .from(redemptionCatalogItems)
      .where(
        and(
          eq(redemptionCatalogItems.creatorParentId, input.parentId),
          eq(redemptionCatalogItems.createIdempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);

    if (existingInTx) {
      if (existingInTx.createIdempotencyPayloadHash !== payloadHash) {
        throw new RedemptionError("IDEMPOTENCY_CONFLICT", "Catalog item idempotency conflict");
      }
      return { item: toCatalogDto(existingInTx), idempotentReplay: true };
    }

    const [inserted] = await tx
      .insert(redemptionCatalogItems)
      .values({
        studentId: input.studentId,
        creatorParentId: input.parentId,
        title: input.body.title,
        description: input.body.description ?? null,
        cost: input.body.cost,
        monthlyLimit: input.body.monthlyLimit ?? null,
        active: true,
        createIdempotencyKey: input.idempotencyKey,
        createIdempotencyPayloadHash: payloadHash,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({
        target: [
          redemptionCatalogItems.creatorParentId,
          redemptionCatalogItems.createIdempotencyKey,
        ],
      })
      .returning();

    if (inserted) {
      await appendAuditEvent(tx, {
        actorId: input.parentId,
        action: "redemption_catalog.created",
        resourceType: "redemption_catalog_item",
        resourceId: inserted.id,
        requestId: input.requestId ?? null,
        idempotencyKey: `audit:redemption-catalog-created:${input.idempotencyKey}`,
        metadata: {
          studentId: input.studentId,
          cost: input.body.cost,
          monthlyLimit: input.body.monthlyLimit ?? null,
        },
      });

      await appendOutboxEvent(tx, {
        aggregateType: "redemption_catalog_item",
        aggregateId: inserted.id,
        eventType: "redemption_catalog.created",
        dedupeKey: `redemption_catalog.created:${input.idempotencyKey}`,
        payload: {
          schemaVersion: 1,
          catalogItemId: inserted.id,
          studentId: input.studentId,
          creatorParentId: input.parentId,
        },
      });

      return { item: toCatalogDto(inserted), idempotentReplay: false };
    }

    const [replay] = await tx
      .select()
      .from(redemptionCatalogItems)
      .where(
        and(
          eq(redemptionCatalogItems.creatorParentId, input.parentId),
          eq(redemptionCatalogItems.createIdempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);

    if (!replay) {
      throw new RedemptionError("STATE_CONFLICT", "Failed to create catalog item");
    }

    if (replay.createIdempotencyPayloadHash !== payloadHash) {
      throw new RedemptionError("IDEMPOTENCY_CONFLICT", "Catalog item idempotency conflict");
    }

    return { item: toCatalogDto(replay), idempotentReplay: true };
  });
}

export type UpdateCatalogItemInput = {
  parentId: string;
  studentId: string;
  itemId: string;
  idempotencyKey: string;
  body: {
    title?: string;
    description?: string | null;
    cost?: number;
    monthlyLimit?: number | null;
    active?: boolean;
  };
  now?: Date;
  requestId?: string;
};

export type UpdateCatalogItemResult = {
  item: CatalogItemDto;
  idempotentReplay: boolean;
};

export async function updateCatalogItem(
  db: Database,
  input: UpdateCatalogItemInput,
): Promise<UpdateCatalogItemResult> {
  await requireVerifiedParent(db, input.parentId);
  await requireActiveRelationship(db, input.parentId, input.studentId);
  await assertStudentAccountNotFrozen(db, input.studentId, "write");

  const payloadHash = hashIdempotencyPayload({ itemId: input.itemId, ...input.body });
  const auditKey = `audit:redemption-catalog-updated:${input.idempotencyKey}`;

  if (input.body.cost != null) {
    if (!Number.isInteger(input.body.cost) || input.body.cost <= 0) {
      throw new RedemptionError("VALIDATION_ERROR", "Cost must be a positive integer");
    }
  }

  if (input.body.monthlyLimit != null) {
    if (!Number.isInteger(input.body.monthlyLimit) || input.body.monthlyLimit <= 0) {
      throw new RedemptionError("VALIDATION_ERROR", "Monthly limit must be a positive integer");
    }
  }

  const now = input.now ?? new Date();

  return db.transaction(async (tx) => {
    const [auditReplay] = await tx
      .select({ resourceId: auditEvents.resourceId, metadata: auditEvents.metadata })
      .from(auditEvents)
      .where(eq(auditEvents.idempotencyKey, auditKey))
      .limit(1);

    if (auditReplay?.resourceId) {
      const storedHash = readStoredPayloadHash(auditReplay.metadata);
      if (auditReplay.resourceId !== input.itemId || storedHash !== payloadHash) {
        throw new RedemptionError("IDEMPOTENCY_CONFLICT", "Catalog update idempotency conflict");
      }
      const [item] = await tx
        .select()
        .from(redemptionCatalogItems)
        .where(eq(redemptionCatalogItems.id, input.itemId))
        .limit(1);
      if (!item) {
        throw new RedemptionError("NOT_FOUND", "Catalog item not found");
      }
      return { item: toCatalogDto(item), idempotentReplay: true };
    }

    const [item] = await tx
      .select()
      .from(redemptionCatalogItems)
      .where(
        and(
          eq(redemptionCatalogItems.id, input.itemId),
          eq(redemptionCatalogItems.studentId, input.studentId),
        ),
      )
      .limit(1);

    if (!item) {
      throw new RedemptionError("NOT_FOUND", "Catalog item not found");
    }

    if (item.creatorParentId !== input.parentId) {
      throw new RedemptionError("FORBIDDEN", "Only the creating parent can edit this catalog item");
    }

    const updates: Partial<typeof redemptionCatalogItems.$inferInsert> = { updatedAt: now };

    if (input.body.title != null) updates.title = input.body.title;
    if (input.body.description !== undefined) updates.description = input.body.description;
    if (input.body.cost != null) updates.cost = input.body.cost;
    if (input.body.monthlyLimit !== undefined) updates.monthlyLimit = input.body.monthlyLimit;
    if (input.body.active != null) updates.active = input.body.active;

    const [updated] = await tx
      .update(redemptionCatalogItems)
      .set(updates)
      .where(eq(redemptionCatalogItems.id, input.itemId))
      .returning();

    if (!updated) {
      throw new RedemptionError("STATE_CONFLICT", "Failed to update catalog item");
    }

    await appendAuditEvent(tx, {
      actorId: input.parentId,
      action: "redemption_catalog.updated",
      resourceType: "redemption_catalog_item",
      resourceId: input.itemId,
      requestId: input.requestId ?? null,
      idempotencyKey: auditKey,
      metadata: {
        studentId: input.studentId,
        payloadHash,
      },
    });

    await appendOutboxEvent(tx, {
      aggregateType: "redemption_catalog_item",
      aggregateId: input.itemId,
      eventType: "redemption_catalog.updated",
      dedupeKey: `redemption_catalog.updated:${input.idempotencyKey}`,
      payload: {
        schemaVersion: 1,
        catalogItemId: input.itemId,
        studentId: input.studentId,
      },
    });

    return { item: toCatalogDto(updated), idempotentReplay: false };
  });
}

export type ListCatalogItemsOptions = {
  viewerRole: "student" | "parent";
  activeOnly?: boolean;
};

export async function listCatalogItems(
  db: Database,
  studentId: string,
  options: ListCatalogItemsOptions,
): Promise<CatalogItemDto[]> {
  await assertStudentAccountNotFrozen(db, studentId, "read");

  const activeOnly = options.viewerRole === "student" ? true : (options.activeOnly ?? false);

  const conditions = [eq(redemptionCatalogItems.studentId, studentId)];
  if (activeOnly) {
    conditions.push(eq(redemptionCatalogItems.active, true));
  }

  const rows = await db
    .select()
    .from(redemptionCatalogItems)
    .where(and(...conditions));

  return rows.map(toCatalogDto);
}

export async function getCatalogItemForStudent(
  db: Database,
  studentId: string,
  itemId: string,
): Promise<typeof redemptionCatalogItems.$inferSelect | null> {
  await assertStudentAccountNotFrozen(db, studentId, "read");

  const [item] = await db
    .select()
    .from(redemptionCatalogItems)
    .where(
      and(eq(redemptionCatalogItems.id, itemId), eq(redemptionCatalogItems.studentId, studentId)),
    )
    .limit(1);

  return item ?? null;
}
