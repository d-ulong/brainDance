import { and, desc, eq, inArray, sql } from "drizzle-orm";

import type { Database } from "@/db";
import {
  goalAssignments,
  goalCommands,
  goalDefinitions,
  goalGiftRedemptions,
  goalNotes,
  pointLedgerEntries,
  relationships,
  users,
} from "@/db/schema";
import { appendAuditEvent } from "@/modules/audit/append-audit-event";
import { requireActiveRelationship } from "@/modules/family-access/authorization.service";
import { FamilyAccessError } from "@/modules/family-access/errors";
import { GoalError } from "@/modules/goals/errors";
import { appendOutboxEvent } from "@/modules/outbox/append-outbox-event";
import { hashIdempotencyPayload } from "@/modules/schedule/normalize-idempotency-payload";
import { upsertBalanceFromLedgerEntry } from "@/modules/settlement/ledger.service";

type GoalActor = { id: string; role: "parent" | "student" };

export type GoalDto = {
  assignmentId: string;
  definitionId: string;
  subjectId: string;
  subjectName: string;
  creatorId: string;
  responsibleParentId: string | null;
  responsibleParentName: string | null;
  source: "parent" | "student";
  content: string;
  dueDate: string;
  expectedPoints: number | null;
  expectedGift: string | null;
  notes: string | null;
  horizon: "short" | "medium" | "long";
  status: "pending_approval" | "active" | "completed" | "succeeded" | "failed";
  actualPoints: number | null;
  actualGift: string | null;
  evaluationReason: string | null;
  evaluatedAt: string | null;
  completedAt: string | null;
  giftRedeemedAt: string | null;
  revision: number;
  postNotes: Array<{ id: string; authorId: string; authorName: string; body: string; createdAt: string }>;
  canApprove: boolean;
  canComplete: boolean;
  canEvaluate: boolean;
  canEdit: boolean;
  canAddNote: boolean;
  canRecordGiftRedemption: boolean;
  isPersonal: boolean;
};

async function requireGoalActor(db: Database, actorId: string): Promise<GoalActor> {
  const [actor] = await db
    .select({ id: users.id, role: users.role, status: users.status, contactVerifiedAt: users.contactVerifiedAt, mustChangePassword: users.mustChangePassword })
    .from(users)
    .where(eq(users.id, actorId))
    .limit(1);
  if (!actor || actor.status !== "active" || (actor.role !== "parent" && actor.role !== "student")) {
    throw new GoalError("FORBIDDEN", "当前账号不能管理目标");
  }
  if (actor.role === "parent" && !actor.contactVerifiedAt) {
    throw new GoalError("FORBIDDEN", "已验证家长权限必需");
  }
  if (actor.role === "student" && actor.mustChangePassword) {
    throw new GoalError("FORBIDDEN", "请先修改初始密码");
  }
  return { id: actor.id, role: actor.role };
}

async function requireLinked(db: Database, parentId: string, studentId: string) {
  try {
    await requireActiveRelationship(db, parentId, studentId);
  } catch (error) {
    if (error instanceof FamilyAccessError) throw new GoalError("FORBIDDEN", "当前没有该学生的有效关联");
    throw error;
  }
}

function normalizeText(value: string | null | undefined, max: number) {
  const normalized = value?.trim() ?? "";
  return normalized ? normalized.slice(0, max) : null;
}

async function findCommand(db: Database, actorId: string, key: string, hash: string) {
  const [command] = await db
    .select()
    .from(goalCommands)
    .where(and(eq(goalCommands.actorId, actorId), eq(goalCommands.key, key)))
    .limit(1);
  if (!command) return null;
  if (command.payloadHash !== hash) throw new GoalError("IDEMPOTENCY_CONFLICT", "相同请求标识对应了不同内容");
  return command.result;
}

export async function createGoals(
  db: Database,
  input: {
    actorId: string;
    subjectIds?: string[];
    content: string;
    dueDate: string;
    expectedPoints?: number | null;
    expectedGift?: string | null;
    notes?: string | null;
    horizon: "short" | "medium" | "long";
    idempotencyKey: string;
  },
) {
  const actor = await requireGoalActor(db, input.actorId);
  const content = input.content.trim();
  if (content.length < 1 || content.length > 500) throw new GoalError("VALIDATION_ERROR", "目标内容须为 1 到 500 字");
  if (input.horizon !== "short" && input.horizon !== "medium" && input.horizon !== "long") {
    throw new GoalError("VALIDATION_ERROR", "目标期限须为近期、中期或远期");
  }
  const expectedPoints = input.expectedPoints ?? null;
  if (expectedPoints !== null && (!Number.isInteger(expectedPoints) || expectedPoints < 0 || expectedPoints > 1_000_000)) {
    throw new GoalError("VALIDATION_ERROR", "期望积分必须为非负整数");
  }
  const subjectIds = actor.role === "student" ? [actor.id] : [...new Set(input.subjectIds ?? [])];
  if (!subjectIds.length || subjectIds.length > 50) throw new GoalError("VALIDATION_ERROR", "请选择 1 到 50 个目标对象");
  if (actor.role === "parent") {
    for (const subjectId of subjectIds) {
      if (subjectId !== actor.id) await requireLinked(db, actor.id, subjectId);
    }
  }
  const payload = {
    subjectIds: [...subjectIds].sort(),
    content,
    dueDate: input.dueDate,
    expectedPoints,
    expectedGift: normalizeText(input.expectedGift, 200),
    notes: normalizeText(input.notes, 1_000),
    horizon: input.horizon,
  };
  const hash = hashIdempotencyPayload(payload);
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`goal-create:${actor.id}:${input.idempotencyKey}`}, 0))`);
    const replay = await findCommand(tx, actor.id, input.idempotencyKey, hash);
    if (replay) return JSON.parse(replay) as { definitionId: string; assignmentIds: string[] };
    const [definition] = await tx
      .insert(goalDefinitions)
      .values({
        creatorId: actor.id,
        responsibleParentId: actor.role === "parent" ? actor.id : null,
        source: actor.role,
        content,
        dueDate: input.dueDate,
        expectedPoints,
        expectedGift: payload.expectedGift,
        notes: payload.notes,
        horizon: payload.horizon,
      })
      .returning({ id: goalDefinitions.id });
    if (!definition) throw new GoalError("STATE_CONFLICT", "目标创建失败");
    const assignments = await tx
      .insert(goalAssignments)
      .values(subjectIds.map((subjectId) => ({
        definitionId: definition.id,
        subjectId,
        responsibleParentId: actor.role === "parent" ? actor.id : null,
        status: actor.role === "parent" ? "active" : "pending_approval",
      })))
      .returning({ id: goalAssignments.id });
    const result = { definitionId: definition.id, assignmentIds: assignments.map((item) => item.id) };
    await tx.insert(goalCommands).values({ actorId: actor.id, key: input.idempotencyKey, payloadHash: hash, result: JSON.stringify(result) });
    await appendAuditEvent(tx, {
      actorId: actor.id,
      action: actor.role === "parent" ? "goal.created" : "goal.proposed",
      resourceType: "goal_definition",
      resourceId: definition.id,
      idempotencyKey: `audit:goal-create:${actor.id}:${input.idempotencyKey}`,
      metadata: { assignmentCount: assignments.length },
    });
    await appendOutboxEvent(tx, {
      aggregateType: "goal_definition",
      aggregateId: definition.id,
      eventType: actor.role === "parent" ? "goal.created" : "goal.proposed",
      dedupeKey: `goal.created:${actor.id}:${input.idempotencyKey}`,
      payload: { definitionId: definition.id, assignmentIds: result.assignmentIds },
    });
    return result;
  });
}

export async function listGoals(db: Database, actorId: string): Promise<GoalDto[]> {
  const actor = await requireGoalActor(db, actorId);
  let visibleSubjects = [actor.id];
  if (actor.role === "parent") {
    const linked = await db
      .select({ studentId: relationships.studentId })
      .from(relationships)
      .where(and(eq(relationships.parentId, actor.id), eq(relationships.status, "active")));
    visibleSubjects = [actor.id, ...linked.map((item) => item.studentId)];
  }
  const rows = await db
    .select({ assignment: goalAssignments, definition: goalDefinitions })
    .from(goalAssignments)
    .innerJoin(goalDefinitions, eq(goalDefinitions.id, goalAssignments.definitionId))
    .where(inArray(goalAssignments.subjectId, visibleSubjects))
    .orderBy(desc(goalAssignments.createdAt));
  const assignmentIds = rows.map(({ assignment }) => assignment.id);
  const notes = assignmentIds.length
    ? await db.select().from(goalNotes).where(inArray(goalNotes.assignmentId, assignmentIds)).orderBy(goalNotes.createdAt)
    : [];
  const notesByAssignment = new Map<string, typeof notes>();
  for (const note of notes) notesByAssignment.set(note.assignmentId, [...(notesByAssignment.get(note.assignmentId) ?? []), note]);
  const definitionIds = [...new Set(rows.map(({ definition }) => definition.id))];
  const terminal = definitionIds.length
    ? await db.select({ definitionId: goalAssignments.definitionId }).from(goalAssignments).where(and(inArray(goalAssignments.definitionId, definitionIds), inArray(goalAssignments.status, ["completed", "succeeded", "failed"])))
    : [];
  const frozenDefinitions = new Set(terminal.map((item) => item.definitionId));
  const userIds = [...new Set([
    ...rows.flatMap(({ assignment }) => [assignment.subjectId, assignment.responsibleParentId].filter((id): id is string => Boolean(id))),
    ...notes.map((note) => note.authorId),
  ])];
  const names = userIds.length
    ? await db.select({ id: users.id, displayName: users.displayName, username: users.username }).from(users).where(inArray(users.id, userIds))
    : [];
  const nameById = new Map(names.map((item) => [item.id, item.displayName || item.username || "未命名成员"]));
  const redemptions = assignmentIds.length
    ? await db.select().from(goalGiftRedemptions).where(inArray(goalGiftRedemptions.assignmentId, assignmentIds))
    : [];
  const redemptionByAssignment = new Map(redemptions.map((item) => [item.assignmentId, item]));
  return rows.map(({ assignment, definition }) => ({
    assignmentId: assignment.id,
    definitionId: definition.id,
    subjectId: assignment.subjectId,
    subjectName: nameById.get(assignment.subjectId) ?? "未命名成员",
    creatorId: definition.creatorId,
    responsibleParentId: assignment.responsibleParentId,
    responsibleParentName: assignment.responsibleParentId ? nameById.get(assignment.responsibleParentId) ?? "家长" : null,
    source: definition.source as "parent" | "student",
    content: definition.content,
    dueDate: definition.dueDate,
    expectedPoints: definition.expectedPoints,
    expectedGift: definition.expectedGift,
    notes: definition.notes,
    horizon: definition.horizon as GoalDto["horizon"],
    status: assignment.status as GoalDto["status"],
    actualPoints: assignment.actualPoints,
    actualGift: assignment.actualGift,
    evaluationReason: assignment.evaluationReason,
    evaluatedAt: assignment.evaluatedAt?.toISOString() ?? null,
    completedAt: assignment.completedAt?.toISOString() ?? null,
    giftRedeemedAt: redemptionByAssignment.get(assignment.id)?.redeemedAt.toISOString() ?? null,
    revision: definition.revision,
    postNotes: (notesByAssignment.get(assignment.id) ?? []).map((note) => ({ id: note.id, authorId: note.authorId, authorName: nameById.get(note.authorId) ?? "家庭成员", body: note.body, createdAt: note.createdAt.toISOString() })),
    canApprove: actor.role === "parent" && assignment.status === "pending_approval" && assignment.subjectId !== actor.id,
    canComplete: actor.id === assignment.subjectId && assignment.status === "active",
    canEvaluate: actor.role === "parent" && assignment.responsibleParentId === actor.id && assignment.status === "completed",
    canEdit: !frozenDefinitions.has(definition.id) && ((actor.role === "parent" && assignment.responsibleParentId === actor.id) || (actor.role === "student" && definition.creatorId === actor.id && assignment.subjectId === actor.id && assignment.status === "pending_approval")),
    canAddNote: actor.role === "parent" && assignment.responsibleParentId === actor.id && (assignment.status === "succeeded" || assignment.status === "failed"),
    canRecordGiftRedemption: actor.role === "parent" && assignment.responsibleParentId === actor.id && assignment.status === "succeeded" && Boolean(assignment.actualGift?.trim()) && !redemptionByAssignment.has(assignment.id),
    isPersonal: assignment.subjectId === definition.creatorId && actor.role === "parent",
  }));
}

export async function updateGoal(db: Database, input: {
  actorId: string; assignmentId: string; revision: number; content: string; dueDate: string;
  expectedPoints?: number | null; expectedGift?: string | null; notes?: string | null; horizon: "short" | "medium" | "long"; idempotencyKey: string;
}) {
  const actor = await requireGoalActor(db, input.actorId);
  const content = input.content.trim();
  if (input.horizon !== "short" && input.horizon !== "medium" && input.horizon !== "long") {
    throw new GoalError("VALIDATION_ERROR", "目标期限须为近期、中期或远期");
  }
  if (content.length < 1 || content.length > 500) throw new GoalError("VALIDATION_ERROR", "目标内容须为 1 到 500 字");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)) throw new GoalError("VALIDATION_ERROR", "完成日期格式不正确");
  const expectedPoints = input.expectedPoints ?? null;
  if (expectedPoints !== null && (!Number.isInteger(expectedPoints) || expectedPoints < 0 || expectedPoints > 1_000_000)) throw new GoalError("VALIDATION_ERROR", "期望积分必须为非负整数");
  const payload = { assignmentId: input.assignmentId, revision: input.revision, content, dueDate: input.dueDate, expectedPoints, expectedGift: normalizeText(input.expectedGift, 200), notes: normalizeText(input.notes, 1_000), horizon: input.horizon, action: "update" };
  const hash = hashIdempotencyPayload(payload);
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM goal_assignments WHERE id = ${input.assignmentId}::uuid FOR UPDATE`);
    const replay = await findCommand(tx, actor.id, input.idempotencyKey, hash);
    if (replay) return JSON.parse(replay) as { assignmentId: string; revision: number };
    const [row] = await tx.select({ assignment: goalAssignments, definition: goalDefinitions }).from(goalAssignments).innerJoin(goalDefinitions, eq(goalDefinitions.id, goalAssignments.definitionId)).where(eq(goalAssignments.id, input.assignmentId)).limit(1);
    if (!row) throw new GoalError("NOT_FOUND", "目标不存在");
    const ownsPendingProposal = actor.role === "student" && row.definition.creatorId === actor.id && row.assignment.subjectId === actor.id && row.assignment.status === "pending_approval";
    const isResponsibleParent = actor.role === "parent" && row.assignment.responsibleParentId === actor.id;
    if (!ownsPendingProposal && !isResponsibleParent) throw new GoalError("FORBIDDEN", "只有目标提案人或责任家长可以编辑");
    const [terminal] = await tx.select({ id: goalAssignments.id }).from(goalAssignments).where(and(eq(goalAssignments.definitionId, row.definition.id), inArray(goalAssignments.status, ["completed", "succeeded", "failed"]))).limit(1);
    if (terminal) throw new GoalError("STATE_CONFLICT", "已有目标完成评定，核心内容不可再修改");
    if (row.definition.revision !== input.revision) throw new GoalError("STATE_CONFLICT", "目标已被更新，请刷新后重试");
    const [updated] = await tx.update(goalDefinitions).set({ content, dueDate: input.dueDate, expectedPoints, expectedGift: payload.expectedGift, notes: payload.notes, horizon: input.horizon, revision: sql`${goalDefinitions.revision} + 1`, updatedAt: new Date() }).where(and(eq(goalDefinitions.id, row.definition.id), eq(goalDefinitions.revision, input.revision))).returning({ revision: goalDefinitions.revision });
    if (!updated) throw new GoalError("STATE_CONFLICT", "目标已被更新，请刷新后重试");
    const result = { assignmentId: row.assignment.id, revision: updated.revision };
    await tx.insert(goalCommands).values({ actorId: actor.id, key: input.idempotencyKey, payloadHash: hash, result: JSON.stringify(result) });
    await appendAuditEvent(tx, { actorId: actor.id, action: "goal.updated", resourceType: "goal_definition", resourceId: row.definition.id, idempotencyKey: `audit:goal-update:${actor.id}:${input.idempotencyKey}`, metadata: { revision: updated.revision } });
    await appendOutboxEvent(tx, { aggregateType: "goal_definition", aggregateId: row.definition.id, eventType: "goal.updated", dedupeKey: `goal.updated:${actor.id}:${input.idempotencyKey}`, payload: result });
    return result;
  });
}

export async function addGoalNote(db: Database, input: { actorId: string; assignmentId: string; body: string; idempotencyKey: string }) {
  const actor = await requireGoalActor(db, input.actorId);
  if (actor.role !== "parent") throw new GoalError("FORBIDDEN", "只有责任家长可以补充评定说明");
  const body = input.body.trim();
  if (body.length < 1 || body.length > 1_000) throw new GoalError("VALIDATION_ERROR", "补充说明须为 1 到 1000 字");
  const hash = hashIdempotencyPayload({ assignmentId: input.assignmentId, body, action: "add-note" });
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM goal_assignments WHERE id = ${input.assignmentId}::uuid FOR UPDATE`);
    const replay = await findCommand(tx, actor.id, input.idempotencyKey, hash);
    if (replay) return JSON.parse(replay) as { noteId: string; assignmentId: string };
    const [assignment] = await tx.select().from(goalAssignments).where(eq(goalAssignments.id, input.assignmentId)).limit(1);
    if (!assignment) throw new GoalError("NOT_FOUND", "目标不存在");
    if (assignment.responsibleParentId !== actor.id) throw new GoalError("FORBIDDEN", "只有该目标的责任家长可以补充说明");
    if (assignment.status !== "succeeded" && assignment.status !== "failed") throw new GoalError("STATE_CONFLICT", "目标评定后才能追加说明");
    const [note] = await tx.insert(goalNotes).values({ assignmentId: assignment.id, authorId: actor.id, body }).returning({ id: goalNotes.id });
    if (!note) throw new GoalError("STATE_CONFLICT", "补充说明保存失败");
    const result = { noteId: note.id, assignmentId: assignment.id };
    await tx.insert(goalCommands).values({ actorId: actor.id, key: input.idempotencyKey, payloadHash: hash, result: JSON.stringify(result) });
    await appendAuditEvent(tx, { actorId: actor.id, action: "goal.note_added", resourceType: "goal_assignment", resourceId: assignment.id, idempotencyKey: `audit:goal-note:${actor.id}:${input.idempotencyKey}` });
    await appendOutboxEvent(tx, { aggregateType: "goal_assignment", aggregateId: assignment.id, eventType: "goal.note_added", dedupeKey: `goal.note_added:${actor.id}:${input.idempotencyKey}`, payload: result });
    return result;
  });
}

export async function approveGoal(db: Database, input: { actorId: string; assignmentId: string; idempotencyKey: string }) {
  const actor = await requireGoalActor(db, input.actorId);
  if (actor.role !== "parent") throw new GoalError("FORBIDDEN", "只有家长可以批准目标");
  const hash = hashIdempotencyPayload({ assignmentId: input.assignmentId, action: "approve" });
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM goal_assignments WHERE id = ${input.assignmentId}::uuid FOR UPDATE`);
    const replay = await findCommand(tx, actor.id, input.idempotencyKey, hash);
    if (replay) return JSON.parse(replay) as { assignmentId: string; status: string };
    const [row] = await tx
      .select({ assignment: goalAssignments, definition: goalDefinitions })
      .from(goalAssignments)
      .innerJoin(goalDefinitions, eq(goalDefinitions.id, goalAssignments.definitionId))
      .where(eq(goalAssignments.id, input.assignmentId))
      .limit(1);
    if (!row) throw new GoalError("NOT_FOUND", "目标不存在");
    await requireLinked(tx, actor.id, row.assignment.subjectId);
    if (row.assignment.status !== "pending_approval" || row.definition.source !== "student") throw new GoalError("STATE_CONFLICT", "该目标当前不可批准");
    await tx.update(goalDefinitions).set({ responsibleParentId: actor.id, updatedAt: new Date() }).where(eq(goalDefinitions.id, row.definition.id));
    await tx.update(goalAssignments).set({ responsibleParentId: actor.id, status: "active", updatedAt: new Date() }).where(eq(goalAssignments.id, row.assignment.id));
    const result = { assignmentId: row.assignment.id, status: "active" };
    await tx.insert(goalCommands).values({ actorId: actor.id, key: input.idempotencyKey, payloadHash: hash, result: JSON.stringify(result) });
    await appendAuditEvent(tx, { actorId: actor.id, action: "goal.approved", resourceType: "goal_assignment", resourceId: row.assignment.id, idempotencyKey: `audit:goal-approve:${actor.id}:${input.idempotencyKey}` });
    await appendOutboxEvent(tx, { aggregateType: "goal_assignment", aggregateId: row.assignment.id, eventType: "goal.approved", dedupeKey: `goal.approved:${actor.id}:${input.idempotencyKey}`, payload: result });
    return result;
  });
}

export async function completeGoal(
  db: Database,
  input: { actorId: string; assignmentId: string; idempotencyKey: string; now?: Date },
) {
  const actor = await requireGoalActor(db, input.actorId);
  const hash = hashIdempotencyPayload({ assignmentId: input.assignmentId, action: "complete" });
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM goal_assignments WHERE id = ${input.assignmentId}::uuid FOR UPDATE`);
    const replay = await findCommand(tx, actor.id, input.idempotencyKey, hash);
    if (replay) return JSON.parse(replay) as { assignmentId: string; status: string; completedAt: string };
    const [row] = await tx
      .select({ assignment: goalAssignments, definition: goalDefinitions })
      .from(goalAssignments)
      .innerJoin(goalDefinitions, eq(goalDefinitions.id, goalAssignments.definitionId))
      .where(eq(goalAssignments.id, input.assignmentId))
      .limit(1);
    if (!row) throw new GoalError("NOT_FOUND", "目标不存在");
    if (row.assignment.subjectId !== actor.id) {
      throw new GoalError("FORBIDDEN", "只有目标对象本人可以标记完成");
    }
    if (row.assignment.status !== "active") {
      throw new GoalError("STATE_CONFLICT", "目标当前不可标记完成");
    }
    const now = input.now ?? new Date();
    await tx
      .update(goalAssignments)
      .set({ status: "completed", completedBy: actor.id, completedAt: now, updatedAt: now })
      .where(eq(goalAssignments.id, row.assignment.id));
    const result = { assignmentId: row.assignment.id, status: "completed", completedAt: now.toISOString() };
    await tx.insert(goalCommands).values({ actorId: actor.id, key: input.idempotencyKey, payloadHash: hash, result: JSON.stringify(result) });
    await appendAuditEvent(tx, {
      actorId: actor.id,
      action: "goal.completed",
      resourceType: "goal_assignment",
      resourceId: row.assignment.id,
      idempotencyKey: `audit:goal-complete:${actor.id}:${input.idempotencyKey}`,
    });
    await appendOutboxEvent(tx, {
      aggregateType: "goal_assignment",
      aggregateId: row.assignment.id,
      eventType: "goal.completed",
      dedupeKey: `goal.completed:${actor.id}:${input.idempotencyKey}`,
      payload: result,
    });
    return result;
  });
}

export async function evaluateGoal(
  db: Database,
  input: { actorId: string; assignmentId: string; outcome: "succeeded" | "failed"; actualPoints?: number | null; actualGift?: string | null; reason?: string | null; idempotencyKey: string; now?: Date },
) {
  const actor = await requireGoalActor(db, input.actorId);
  if (actor.role !== "parent") throw new GoalError("FORBIDDEN", "只有责任家长可以评定目标");
  const actualPoints = input.actualPoints ?? 0;
  if (!Number.isInteger(actualPoints) || actualPoints < 0 || actualPoints > 1_000_000) throw new GoalError("VALIDATION_ERROR", "最终积分必须为非负整数");
  const actualGift = normalizeText(input.actualGift, 200);
  const reason = normalizeText(input.reason, 500);
  const hash = hashIdempotencyPayload({ assignmentId: input.assignmentId, outcome: input.outcome, actualPoints, actualGift, reason });
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM goal_assignments WHERE id = ${input.assignmentId}::uuid FOR UPDATE`);
    const replay = await findCommand(tx, actor.id, input.idempotencyKey, hash);
    if (replay) return JSON.parse(replay) as { assignmentId: string; status: string; ledgerEntryId: string | null };
    const [row] = await tx
      .select({ assignment: goalAssignments, definition: goalDefinitions })
      .from(goalAssignments)
      .innerJoin(goalDefinitions, eq(goalDefinitions.id, goalAssignments.definitionId))
      .where(eq(goalAssignments.id, input.assignmentId))
      .limit(1);
    if (!row) throw new GoalError("NOT_FOUND", "目标不存在");
    if (row.assignment.responsibleParentId !== actor.id) throw new GoalError("FORBIDDEN", "只有该目标的责任家长可以评定");
    if (row.assignment.subjectId !== actor.id) {
      await requireLinked(tx, actor.id, row.assignment.subjectId);
    }
    if (row.assignment.status !== "completed") throw new GoalError("STATE_CONFLICT", "目标尚未完成或已经评定");
    const [subject] = await tx.select({ role: users.role }).from(users).where(eq(users.id, row.assignment.subjectId)).limit(1);
    if (!subject) throw new GoalError("NOT_FOUND", "目标对象不存在");
    const finalPoints = subject.role === "student" && input.outcome === "succeeded" ? actualPoints : 0;
    const finalGift = subject.role === "student" && input.outcome === "succeeded" ? actualGift : null;
    const differs = subject.role === "student" && (finalPoints !== (row.definition.expectedPoints ?? 0) || (finalGift ?? "") !== (row.definition.expectedGift ?? ""));
    if (differs && (!reason || reason.length < 2)) throw new GoalError("VALIDATION_ERROR", "最终奖励与期望不同时必须填写原因");
    const now = input.now ?? new Date();
    await tx.update(goalAssignments).set({ status: input.outcome, actualPoints: finalPoints, actualGift: finalGift, evaluationReason: reason, evaluatedBy: actor.id, evaluatedAt: now, updatedAt: now }).where(eq(goalAssignments.id, row.assignment.id));
    let ledgerEntryId: string | null = null;
    if (finalPoints > 0) {
      const [ledger] = await tx.insert(pointLedgerEntries).values({
        studentId: row.assignment.subjectId,
        settlementId: null,
        amount: finalPoints,
        reason: "goal.reward",
        sourceType: "goal_reward",
        explanation: reason ?? "目标达成奖励",
        sourceId: row.assignment.id,
        reversesEntryId: null,
        createdBy: actor.id,
        idempotencyKey: `goal-reward:${input.idempotencyKey}`,
        createdAt: now,
      }).returning({ id: pointLedgerEntries.id });
      if (!ledger) throw new GoalError("STATE_CONFLICT", "目标奖励流水创建失败");
      ledgerEntryId = ledger.id;
      await upsertBalanceFromLedgerEntry(tx, { studentId: row.assignment.subjectId, ledgerEntryId: ledger.id, amount: finalPoints, createdAt: now, now });
    }
    const result = { assignmentId: row.assignment.id, status: input.outcome, ledgerEntryId };
    await tx.insert(goalCommands).values({ actorId: actor.id, key: input.idempotencyKey, payloadHash: hash, result: JSON.stringify(result) });
    await appendAuditEvent(tx, { actorId: actor.id, action: "goal.evaluated", resourceType: "goal_assignment", resourceId: row.assignment.id, idempotencyKey: `audit:goal-evaluate:${actor.id}:${input.idempotencyKey}`, metadata: { outcome: input.outcome, points: finalPoints, hasGift: Boolean(finalGift) } });
    await appendOutboxEvent(tx, { aggregateType: "goal_assignment", aggregateId: row.assignment.id, eventType: "goal.evaluated", dedupeKey: `goal.evaluated:${actor.id}:${input.idempotencyKey}`, payload: { assignmentId: row.assignment.id, outcome: input.outcome, points: finalPoints } });
    return result;
  });
}

export async function recordGoalGiftRedemption(
  db: Database,
  input: { actorId: string; assignmentId: string; redeemedAt: string; idempotencyKey: string },
) {
  const actor = await requireGoalActor(db, input.actorId);
  if (actor.role !== "parent") throw new GoalError("FORBIDDEN", "只有责任家长可以记录礼物兑现");
  const redeemedAt = new Date(input.redeemedAt);
  if (!Number.isFinite(redeemedAt.getTime())) {
    throw new GoalError("VALIDATION_ERROR", "兑现时间格式不正确");
  }
  if (redeemedAt.getTime() > Date.now()) {
    throw new GoalError("VALIDATION_ERROR", "兑现时间不能是未来");
  }
  const payload = {
    assignmentId: input.assignmentId,
    redeemedAt: redeemedAt.toISOString(),
    action: "gift-redemption",
  };
  const hash = hashIdempotencyPayload(payload);
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM goal_assignments WHERE id = ${input.assignmentId}::uuid FOR UPDATE`);
    const replay = await findCommand(tx, actor.id, input.idempotencyKey, hash);
    if (replay) return JSON.parse(replay) as { assignmentId: string; giftRedeemedAt: string };
    const [assignment] = await tx.select().from(goalAssignments).where(eq(goalAssignments.id, input.assignmentId)).limit(1);
    if (!assignment) throw new GoalError("NOT_FOUND", "目标不存在");
    if (assignment.responsibleParentId !== actor.id) {
      throw new GoalError("FORBIDDEN", "只有该目标的责任家长可以记录礼物兑现");
    }
    if (assignment.status !== "succeeded") {
      throw new GoalError("STATE_CONFLICT", "只有已达成的目标才能记录礼物兑现");
    }
    if (!assignment.actualGift?.trim()) {
      throw new GoalError("STATE_CONFLICT", "没有实际礼物的目标不能记录兑现");
    }
    const [existing] = await tx
      .select()
      .from(goalGiftRedemptions)
      .where(eq(goalGiftRedemptions.assignmentId, assignment.id))
      .limit(1);
    if (existing) throw new GoalError("STATE_CONFLICT", "该目标礼物已兑现");
    await tx.insert(goalGiftRedemptions).values({
      assignmentId: assignment.id,
      recordedBy: actor.id,
      redeemedAt,
    });
    const result = { assignmentId: assignment.id, giftRedeemedAt: redeemedAt.toISOString() };
    await tx.insert(goalCommands).values({
      actorId: actor.id,
      key: input.idempotencyKey,
      payloadHash: hash,
      result: JSON.stringify(result),
    });
    await appendAuditEvent(tx, {
      actorId: actor.id,
      action: "goal.gift_redeemed",
      resourceType: "goal_assignment",
      resourceId: assignment.id,
      idempotencyKey: `audit:goal-gift-redemption:${actor.id}:${input.idempotencyKey}`,
      metadata: { redeemedAt: redeemedAt.toISOString() },
    });
    await appendOutboxEvent(tx, {
      aggregateType: "goal_assignment",
      aggregateId: assignment.id,
      eventType: "goal.gift_redeemed",
      dedupeKey: `goal.gift_redeemed:${actor.id}:${input.idempotencyKey}`,
      payload: result,
    });
    return result;
  });
}
