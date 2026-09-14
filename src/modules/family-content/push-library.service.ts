import { and, desc, eq, sql } from "drizzle-orm";
import type { Database } from "@/db";
import { familyPushes } from "@/db/schema/family-content";
import { pushLibraryEntries as entries, pushLibraryPublications as publications, pushLibraryDeliveries as deliveries } from "@/db/schema/push-library";
import { appendAuditEvent } from "@/modules/audit/append-audit-event";
import { appendOutboxEvent } from "@/modules/outbox/append-outbox-event";
import { listLinkedStudentsForParent } from "@/modules/family-access/linked-students.service";
import { hasActiveRelationship } from "@/modules/family-access/authorization.service";
import { loadUserRole, requireParentLinkedToStudent, assertStudentNotFrozenForFamilyContent } from "./access";
import { createFamilyPush } from "./create-push.service";
import { normalizePushContent } from "./content";
import { FamilyContentError } from "./errors";
import { hashIdempotencyPayload } from "@/modules/schedule/normalize-idempotency-payload";

type Content = { body?: string | null; linkUrl?: string | null; tags?: string[]; answerDisclosureDays?: number | null };
async function requireParent(db: Database, actorId: string) {
  if (await loadUserRole(db, actorId) !== "parent") throw new FamilyContentError("FORBIDDEN", "仅家长可管理推送库");
}
async function owned(db: Database, actorId: string, entryId: string) {
  await requireParent(db, actorId);
  const [entry] = await db.select().from(entries).where(and(eq(entries.id, entryId), eq(entries.ownerId, actorId)));
  if (!entry) throw new FamilyContentError("NOT_FOUND", "推送内容不存在");
  return entry;
}
function normalize(input: Content) {
  const { body, linkUrl } = normalizePushContent(input);
  if (input.answerDisclosureDays !== undefined && input.answerDisclosureDays !== null && (!Number.isInteger(input.answerDisclosureDays) || input.answerDisclosureDays < 0 || input.answerDisclosureDays > 365)) throw new FamilyContentError("VALIDATION_ERROR", "公开天数须为 0 至 365 的整数");
  const tags = [...new Set((input.tags ?? []).map(t => t.trim()).filter(Boolean))].sort();
  if (tags.length > 20 || tags.some(t => t.length > 40)) throw new FamilyContentError("VALIDATION_ERROR", "最多 20 个标签，每个不超过 40 字");
  return { body, linkUrl, tags, answerDisclosureDays: input.answerDisclosureDays ?? null };
}
async function record(db: Database, actorId: string, entryId: string, command: string, key: string) {
  await appendAuditEvent(db, { actorId, action: `push_library.${command}`, resourceType: "push_library", resourceId: entryId, idempotencyKey: `library:${actorId}:${key}`, metadata: {} });
  await appendOutboxEvent(db, { aggregateType: "push_library", aggregateId: entryId, eventType: "push_library.changed", dedupeKey: `library:${actorId}:${key}`, payload: { entryId, command } });
}
export async function savePushLibraryEntry(db: Database, input: Content & { actorId: string; entryId?: string; revision?: number; idempotencyKey: string }) {
  await requireParent(db, input.actorId);
  const content = normalize(input);
  const hash = hashIdempotencyPayload(content);
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`push-library:${input.actorId}`}, 0))`);
    if (!input.entryId) {
      const [replay] = await tx.select().from(entries).where(and(eq(entries.ownerId, input.actorId), eq(entries.createKey, input.idempotencyKey)));
      if (replay) {
        if (replay.createHash !== hash) throw new FamilyContentError("IDEMPOTENCY_CONFLICT", "保存请求内容不一致");
        return replay;
      }
      const [entry] = await tx.insert(entries).values({ ownerId: input.actorId, ...content, createKey: input.idempotencyKey, createHash: hash }).returning();
      await record(tx, input.actorId, entry!.id, "created", input.idempotencyKey);
      return entry!;
    }
    const entry = await owned(tx, input.actorId, input.entryId);
    if (entry.revision !== input.revision) throw new FamilyContentError("STATE_CONFLICT", "内容已更新，请刷新后编辑");
    const [updated] = await tx.update(entries).set({ ...content, revision: entry.revision + 1, updatedAt: new Date() }).where(eq(entries.id, entry.id)).returning();
    await record(tx, input.actorId, entry.id, "updated", `${entry.id}:${entry.revision + 1}`);
    return updated!;
  });
}
export async function publishPushLibraryEntry(db: Database, input: {
  actorId: string; entryId: string; revision: number; studentIds: string[];
  publishMode: "immediate" | "scheduled"; scheduledPublishAt?: string;
  mediaIdsByStudent?: Record<string, string[]>; idempotencyKey: string;
}) {
  const studentIds = [...new Set(input.studentIds)].sort();
  if (!studentIds.length || studentIds.length > 100) throw new FamilyContentError("VALIDATION_ERROR", "请选择 1 至 100 名接收学生");
  if (Object.keys(input.mediaIdsByStudent ?? {}).some(id => !studentIds.includes(id))) throw new FamilyContentError("VALIDATION_ERROR", "图片接收学生不匹配");
  const hash = hashIdempotencyPayload({ revision: input.revision, studentIds, publishMode: input.publishMode, scheduledPublishAt: input.scheduledPublishAt ?? null, media: input.mediaIdsByStudent ?? {} });
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`push-library:${input.actorId}`}, 0))`);
    const entry = await owned(tx, input.actorId, input.entryId);
    for (const studentId of studentIds) {
      await tx.execute(sql`SELECT id FROM users WHERE id = ${studentId}::uuid FOR UPDATE`);
      await requireParentLinkedToStudent(tx, input.actorId, studentId);
      await assertStudentNotFrozenForFamilyContent(tx, studentId, "write");
    }
    const [replay] = await tx.select().from(publications).where(and(eq(publications.entryId, entry.id), eq(publications.commandKey, input.idempotencyKey)));
    if (replay) {
      if (replay.payloadHash !== hash) throw new FamilyContentError("IDEMPOTENCY_CONFLICT", "发布请求内容不一致");
      return { publicationId: replay.id, idempotentReplay: true };
    }
    if (entry.revision !== input.revision) throw new FamilyContentError("STATE_CONFLICT", "内容已更新，请刷新后发布");
    const [publication] = await tx.insert(publications).values({ entryId: entry.id, revision: entry.revision, commandKey: input.idempotencyKey, payloadHash: hash, tags: entry.tags }).returning();
    for (const studentId of studentIds) {
      const result = await createFamilyPush(tx, { actorId: input.actorId, studentId, body: entry.body, linkUrl: entry.linkUrl, mediaIds: input.mediaIdsByStudent?.[studentId], publishMode: input.publishMode, scheduledPublishAt: input.scheduledPublishAt, answerDisclosureDays: entry.answerDisclosureDays, idempotencyKey: `library:${publication!.id}:${studentId}` });
      await tx.insert(deliveries).values({ publicationId: publication!.id, studentId, pushId: result.push.pushId });
    }
    await record(tx, input.actorId, entry.id, "published", publication!.id);
    return { publicationId: publication!.id, idempotentReplay: false };
  });
}

export async function listPushLibrary(db: Database, input: { actorId: string; studentId?: string; from?: string; through?: string; tags?: string[] }) {
  await requireParent(db, input.actorId);
  if (input.studentId) await requireParentLinkedToStudent(db, input.actorId, input.studentId);
  const students = await listLinkedStudentsForParent(db, input.actorId);
  const result = [];
  const rows = await db.select().from(entries).where(eq(entries.ownerId, input.actorId)).orderBy(desc(entries.updatedAt)).limit(200);
  for (const entry of rows) {
    const snapshots = await db.select({ studentId: deliveries.studentId, pushId: deliveries.pushId, status: familyPushes.status, publishedAt: familyPushes.publishedAt, scheduledAt: familyPushes.scheduledPublishAt, tags: publications.tags }).from(deliveries).innerJoin(publications, eq(publications.id, deliveries.publicationId)).innerJoin(familyPushes, eq(familyPushes.id, deliveries.pushId)).where(eq(publications.entryId, entry.id));
    const visible = [];
    for (const snapshot of snapshots) {
      if (!await hasActiveRelationship(db, input.actorId, snapshot.studentId)) continue;
      const date = (snapshot.publishedAt ?? snapshot.scheduledAt)?.toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
      if (input.studentId && snapshot.studentId !== input.studentId) continue;
      if (input.from && (!date || date < input.from)) continue;
      if (input.through && (!date || date > input.through)) continue;
      if (input.tags?.length && !input.tags.some(tag => snapshot.tags.includes(tag))) continue;
      visible.push(snapshot);
    }
    const createdDate = entry.createdAt.toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
    const draftMatches = !snapshots.length && !input.studentId && (!input.from || createdDate >= input.from) && (!input.through || createdDate <= input.through) && (!input.tags?.length || input.tags.some(t => entry.tags.includes(t)));
    if (visible.length || draftMatches || (!input.studentId && !input.from && !input.through && !input.tags?.length)) result.push({ ...entry, deliveries: visible });
  }
  return { entries: result, students };
}
