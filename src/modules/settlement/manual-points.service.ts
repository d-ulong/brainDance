import { randomUUID } from "node:crypto";

import { and, desc, eq, inArray, or, sql } from "drizzle-orm";

import type { Database } from "@/db";
import {
  manualPointAdjustments,
  planItemRules,
  pointBalanceProjection,
  pointLedgerEntries,
  scheduleItems,
  settlements,
  users,
} from "@/db/schema";
import { appendAuditEvent } from "@/modules/audit/append-audit-event";
import { requireActiveRelationship } from "@/modules/family-access/authorization.service";
import { FamilyAccessError } from "@/modules/family-access/errors";
import { appendOutboxEvent } from "@/modules/outbox/append-outbox-event";
import { hashIdempotencyPayload } from "@/modules/schedule/normalize-idempotency-payload";
import { SettlementError } from "@/modules/settlement/errors";
import { upsertBalanceFromLedgerEntry } from "@/modules/settlement/ledger.service";

async function requireParentStudent(db: Database, parentId: string, studentId: string) {
  const [parent] = await db.select({ role: users.role, verified: users.contactVerifiedAt }).from(users).where(eq(users.id, parentId)).limit(1);
  if (!parent || parent.role !== "parent" || !parent.verified) throw new SettlementError("FORBIDDEN", "已验证家长权限必需");
  try {
    await requireActiveRelationship(db, parentId, studentId);
  } catch (error) {
    if (error instanceof FamilyAccessError) throw new SettlementError("FORBIDDEN", "当前没有该学生的有效关联");
    throw error;
  }
}

function validateReason(reason: string) {
  const value = reason.trim();
  if (value.length < 2 || value.length > 200) throw new SettlementError("VALIDATION_ERROR", "原因须为 2 到 200 字");
  return value;
}

export async function createManualPenalty(
  db: Database,
  input: { actorParentId: string; studentId: string; points: number; reason: string; idempotencyKey: string; now?: Date },
) {
  await requireParentStudent(db, input.actorParentId, input.studentId);
  if (!Number.isInteger(input.points) || input.points <= 0 || input.points > 1_000_000) throw new SettlementError("VALIDATION_ERROR", "扣分必须为正整数");
  const reason = validateReason(input.reason);
  const hash = hashIdempotencyPayload({ studentId: input.studentId, points: input.points, reason });
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM users WHERE id = ${input.studentId}::uuid FOR UPDATE`);
    const [replay] = await tx.select().from(manualPointAdjustments).where(and(eq(manualPointAdjustments.actorParentId, input.actorParentId), eq(manualPointAdjustments.idempotencyKey, input.idempotencyKey))).limit(1);
    if (replay) {
      if (replay.payloadHash !== hash) throw new SettlementError("IDEMPOTENCY_CONFLICT", "扣分请求内容不一致");
      return { adjustmentId: replay.id, ledgerEntryId: replay.ledgerEntryId, amount: replay.amount, idempotentReplay: true };
    }
    const [projection] = await tx.select({ balance: pointBalanceProjection.balance }).from(pointBalanceProjection).where(eq(pointBalanceProjection.studentId, input.studentId)).limit(1);
    const balance = projection?.balance ?? 0;
    if (input.points > balance) throw new SettlementError("STATE_CONFLICT", `积分余额不足，当前可扣 ${balance} 分`);
    const now = input.now ?? new Date();
    const adjustmentId = randomUUID();
    const ledgerEntryId = randomUUID();
    await tx.insert(pointLedgerEntries).values({
      id: ledgerEntryId,
      studentId: input.studentId,
      settlementId: null,
      amount: -input.points,
      reason: "manual.penalty",
      sourceType: "manual_penalty",
      explanation: reason,
      sourceId: adjustmentId,
      reversesEntryId: null,
      createdBy: input.actorParentId,
      idempotencyKey: `manual-penalty:${input.idempotencyKey}`,
      createdAt: now,
    });
    await tx.insert(manualPointAdjustments).values({ id: adjustmentId, studentId: input.studentId, actorParentId: input.actorParentId, kind: "penalty", amount: -input.points, reason, ledgerEntryId, idempotencyKey: input.idempotencyKey, payloadHash: hash, createdAt: now });
    await upsertBalanceFromLedgerEntry(tx, { studentId: input.studentId, ledgerEntryId, amount: -input.points, createdAt: now, now });
    await appendAuditEvent(tx, { actorId: input.actorParentId, action: "points.manual_penalty", resourceType: "manual_point_adjustment", resourceId: adjustmentId, reasonCode: "parent_penalty", idempotencyKey: `audit:manual-penalty:${input.actorParentId}:${input.idempotencyKey}`, metadata: { studentId: input.studentId, amount: -input.points } });
    await appendOutboxEvent(tx, { aggregateType: "manual_point_adjustment", aggregateId: adjustmentId, eventType: "points.manual_penalty", dedupeKey: `points.manual_penalty:${input.actorParentId}:${input.idempotencyKey}`, payload: { adjustmentId, studentId: input.studentId, amount: -input.points } });
    return { adjustmentId, ledgerEntryId, amount: -input.points, idempotentReplay: false };
  });
}

export async function reverseManualPenalty(
  db: Database,
  input: { actorParentId: string; studentId: string; adjustmentId: string; reason: string; idempotencyKey: string; now?: Date },
) {
  const reason = validateReason(input.reason);
  const hash = hashIdempotencyPayload({ adjustmentId: input.adjustmentId, reason, action: "reverse" });
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM manual_point_adjustments WHERE id = ${input.adjustmentId}::uuid FOR UPDATE`);
    const [original] = await tx.select().from(manualPointAdjustments).where(eq(manualPointAdjustments.id, input.adjustmentId)).limit(1);
    if (!original || original.kind !== "penalty") throw new SettlementError("NOT_FOUND", "原扣分记录不存在");
    if (original.studentId !== input.studentId) throw new SettlementError("NOT_FOUND", "原扣分记录不存在");
    await requireParentStudent(tx, input.actorParentId, original.studentId);
    if (original.actorParentId !== input.actorParentId) throw new SettlementError("FORBIDDEN", "只有原扣分家长可以撤销");
    await tx.execute(sql`SELECT id FROM users WHERE id = ${original.studentId}::uuid FOR UPDATE`);
    const [replay] = await tx.select().from(manualPointAdjustments).where(and(eq(manualPointAdjustments.actorParentId, input.actorParentId), eq(manualPointAdjustments.idempotencyKey, input.idempotencyKey))).limit(1);
    if (replay) {
      if (replay.payloadHash !== hash) throw new SettlementError("IDEMPOTENCY_CONFLICT", "撤销请求内容不一致");
      return { adjustmentId: replay.id, ledgerEntryId: replay.ledgerEntryId, amount: replay.amount, idempotentReplay: true };
    }
    const [existing] = await tx.select({ id: manualPointAdjustments.id }).from(manualPointAdjustments).where(and(eq(manualPointAdjustments.kind, "reversal"), eq(manualPointAdjustments.originalAdjustmentId, original.id))).limit(1);
    if (existing) throw new SettlementError("STATE_CONFLICT", "该扣分已经撤销");
    const now = input.now ?? new Date();
    const adjustmentId = randomUUID();
    const ledgerEntryId = randomUUID();
    const amount = -original.amount;
    await tx.insert(pointLedgerEntries).values({
      id: ledgerEntryId,
      studentId: original.studentId,
      settlementId: null,
      amount,
      reason: "manual.penalty_reversal",
      sourceType: "manual_penalty_reversal",
      explanation: reason,
      sourceId: adjustmentId,
      reversesEntryId: original.ledgerEntryId,
      createdBy: input.actorParentId,
      idempotencyKey: `manual-penalty-reversal:${input.idempotencyKey}`,
      createdAt: now,
    });
    await tx.insert(manualPointAdjustments).values({ id: adjustmentId, studentId: original.studentId, actorParentId: input.actorParentId, kind: "reversal", amount, reason, originalAdjustmentId: original.id, ledgerEntryId, idempotencyKey: input.idempotencyKey, payloadHash: hash, createdAt: now });
    await upsertBalanceFromLedgerEntry(tx, { studentId: original.studentId, ledgerEntryId, amount, createdAt: now, now });
    await appendAuditEvent(tx, { actorId: input.actorParentId, action: "points.manual_penalty_reversed", resourceType: "manual_point_adjustment", resourceId: adjustmentId, reasonCode: "penalty_correction", idempotencyKey: `audit:manual-penalty-reversal:${input.actorParentId}:${input.idempotencyKey}`, metadata: { studentId: original.studentId, originalAdjustmentId: original.id, amount } });
    await appendOutboxEvent(tx, { aggregateType: "manual_point_adjustment", aggregateId: adjustmentId, eventType: "points.manual_penalty_reversed", dedupeKey: `points.manual_penalty_reversed:${input.actorParentId}:${input.idempotencyKey}`, payload: { adjustmentId, originalAdjustmentId: original.id, studentId: original.studentId, amount } });
    return { adjustmentId, ledgerEntryId, amount, idempotentReplay: false };
  });
}

export async function listManualPenalties(db: Database, input: { actorId: string; actorRole: string; studentId: string }) {
  if (input.actorRole === "student") {
    if (input.actorId !== input.studentId) throw new SettlementError("FORBIDDEN", "只能查看自己的积分记录");
  } else if (input.actorRole === "parent") {
    await requireParentStudent(db, input.actorId, input.studentId);
  } else throw new SettlementError("FORBIDDEN", "当前角色不能查看扣分记录");
  const rows = await db.select({ adjustment: manualPointAdjustments, actorName: users.displayName }).from(manualPointAdjustments).innerJoin(users, eq(users.id, manualPointAdjustments.actorParentId)).where(eq(manualPointAdjustments.studentId, input.studentId)).orderBy(desc(manualPointAdjustments.createdAt));
  const reversedIds = new Set(rows.map(({ adjustment }) => adjustment.originalAdjustmentId).filter((id): id is string => Boolean(id)));
  return rows.map(({ adjustment, actorName }) => ({ ...adjustment, actorName, canReverse: adjustment.kind === "penalty" && adjustment.actorParentId === input.actorId && !reversedIds.has(adjustment.id) }));
}

export function maximumEntryPoints(entry: Record<string, unknown>) {
  const points = entry.points;
  if (!points || typeof points !== "object") return 0;
  const values = Object.values(points as Record<string, unknown>).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return Math.max(0, ...values);
}

export async function getPointsPeriodSummary(db: Database, input: { actorId: string; actorRole: string; studentId: string; from: string; through: string }) {
  const fromTime = Date.parse(`${input.from}T00:00:00Z`);
  const throughTime = Date.parse(`${input.through}T00:00:00Z`);
  if (!Number.isFinite(fromTime) || !Number.isFinite(throughTime) || throughTime < fromTime || throughTime - fromTime > 370 * 86_400_000) {
    throw new SettlementError("VALIDATION_ERROR", "积分汇总日期范围无效或超过 371 天");
  }
  if (input.actorRole === "student") {
    if (input.actorId !== input.studentId) throw new SettlementError("FORBIDDEN", "只能查看自己的积分汇总");
  } else if (input.actorRole === "parent") {
    if (input.actorId !== input.studentId) await requireParentStudent(db, input.actorId, input.studentId);
  } else throw new SettlementError("FORBIDDEN", "当前角色不能查看积分汇总");
  const ledger = await db.select({ id: pointLedgerEntries.id, amount: pointLedgerEntries.amount, reason: pointLedgerEntries.reason, sourceType: pointLedgerEntries.sourceType, explanation: pointLedgerEntries.explanation, createdAt: pointLedgerEntries.createdAt, settlementPeriod: settlements.settlementPeriod }).from(pointLedgerEntries).leftJoin(settlements, eq(settlements.id, pointLedgerEntries.settlementId)).where(and(eq(pointLedgerEntries.studentId, input.studentId), or(
    and(inArray(pointLedgerEntries.sourceType, ["settlement", "reversal"]), sql`${settlements.settlementPeriod} BETWEEN ${input.from}::date AND ${input.through}::date`),
    and(inArray(pointLedgerEntries.sourceType, ["goal_reward", "manual_penalty", "manual_penalty_reversal"]), sql`(${pointLedgerEntries.createdAt} AT TIME ZONE 'Asia/Shanghai')::date BETWEEN ${input.from}::date AND ${input.through}::date`),
  ))).orderBy(desc(pointLedgerEntries.createdAt));
  const scheduleRows = await db.select({ entry: planItemRules.entry }).from(scheduleItems).innerJoin(planItemRules, eq(planItemRules.scheduleItemId, scheduleItems.id)).where(and(eq(scheduleItems.studentId, input.studentId), sql`${scheduleItems.familyDate} BETWEEN ${input.from}::date AND ${input.through}::date`, inArray(scheduleItems.status, ["pending", "completed"]), sql`${scheduleItems.suppressedByScheduleItemId} IS NULL`));
  const schedulePoints = ledger.filter((item) => item.sourceType === "settlement" || item.sourceType === "reversal").reduce((sum, item) => sum + item.amount, 0);
  const goalRewards = ledger.filter((item) => item.sourceType === "goal_reward").reduce((sum, item) => sum + item.amount, 0);
  const manualAdjustments = ledger.filter((item) => item.sourceType === "manual_penalty" || item.sourceType === "manual_penalty_reversal").reduce((sum, item) => sum + item.amount, 0);
  return {
    from: input.from,
    through: input.through,
    schedulePoints,
    goalRewards,
    manualAdjustments,
    netPoints: schedulePoints + goalRewards + manualAdjustments,
    maximumSchedulePoints: scheduleRows.reduce((sum, item) => sum + maximumEntryPoints(item.entry), 0),
    entries: ledger.map((item) => ({ id: item.id, amount: item.amount, reason: item.reason, explanation: item.explanation, sourceType: item.sourceType, occurredAt: item.createdAt.toISOString() })),
  };
}
