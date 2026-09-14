import { config } from "dotenv";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { listPushLibrary, publishPushLibraryEntry, savePushLibraryEntry } from "@/modules/family-content/push-library.service";
import { submitPushAnswer } from "@/modules/family-content/answer.service";
import { createPushComment, listPushComments } from "@/modules/family-content/comment.service";
import { acceptParentForStudent, seedStudentUser } from "../../helpers/family-access";
import { bootstrapParentStudentRelationship, resetScheduleTables } from "../../helpers/schedule";
import { closeTestDb, getTestDb, migrateTestDb, resetIdentityTables } from "../../helpers/db";

config({ path: ".env.local" }); config({ path: ".env" });
const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);
describe.skipIf(!hasDb)("independent push library", () => {
  const db = getTestDb();
  beforeAll(async () => { await migrateTestDb(); });
  beforeEach(async () => { await resetIdentityTables(db); await resetScheduleTables(db); });
  afterAll(async () => { await closeTestDb(); });
  it("saves one owner draft and publishes separate authorized deliveries", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);
    const entry = await savePushLibraryEntry(db, { actorId: parentId, body: "今天读书", tags: ["阅读", "阅读"], idempotencyKey: "draft-1" });
    const replay = await savePushLibraryEntry(db, { actorId: parentId, body: "今天读书", tags: ["阅读"], idempotencyKey: "draft-1" });
    expect(replay.id).toBe(entry.id);
    const publication = await publishPushLibraryEntry(db, { actorId: parentId, entryId: entry.id, revision: entry.revision, studentIds: [studentId], publishMode: "immediate", idempotencyKey: "publish-1" });
    expect(publication.idempotentReplay).toBe(false);
    const listed = await listPushLibrary(db, { actorId: parentId, studentId, tags: ["阅读"] });
    expect(listed.entries).toHaveLength(1); expect(listed.entries[0]?.deliveries).toHaveLength(1);
  });
  it("lets a student reply to a disclosed peer answer across sibling deliveries", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);
    const peer = await seedStudentUser(db, {
      username: `peer_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });
    await acceptParentForStudent(db, { parentId, studentId: peer.studentId });
    const entry = await savePushLibraryEntry(db, {
      actorId: parentId,
      body: "一起讨论",
      answerDisclosureDays: null,
      idempotencyKey: "shared-thread-entry",
    });
    await publishPushLibraryEntry(db, {
      actorId: parentId,
      entryId: entry.id,
      revision: entry.revision,
      studentIds: [studentId, peer.studentId],
      publishMode: "immediate",
      idempotencyKey: "shared-thread-publish",
    });
    const listed = await listPushLibrary(db, { actorId: parentId });
    const deliveryByStudent = new Map(
      listed.entries[0]!.deliveries.map((delivery) => [delivery.studentId, delivery.pushId]),
    );
    const answer = await submitPushAnswer(db, {
      studentId: peer.studentId,
      pushId: deliveryByStudent.get(peer.studentId)!,
      body: "伙伴的答案",
      idempotencyKey: "peer-answer",
    });
    const reply = await createPushComment(db, {
      actorId: studentId,
      actorRole: "student",
      pushId: deliveryByStudent.get(studentId)!,
      body: "我赞同这个思路",
      quotedAnswerId: answer.answer.answerId,
      idempotencyKey: "student-peer-reply",
    });
    expect(reply.comment.quotedAnswerId).toBe(answer.answer.answerId);
    expect(reply.comment.reference).toEqual({
      kind: "quoted_answer",
      authorName: expect.any(String),
      body: "伙伴的答案",
    });
    expect(
      (await listPushComments(db, { actorId: studentId, actorRole: "student", pushId: deliveryByStudent.get(studentId)! }))[0],
    ).toMatchObject({
      body: "我赞同这个思路",
      quotedAnswerId: answer.answer.answerId,
      reference: { kind: "quoted_answer", body: "伙伴的答案" },
    });
  });
});
