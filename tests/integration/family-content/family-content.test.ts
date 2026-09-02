import { config } from "dotenv";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  auditEvents,
  familyPushes,
  familyPushVersions,
  notifications,
  outboxEvents,
  pushAnswerVersions,
} from "@/db/schema";
import { DELETION_TARGET_TYPE } from "@/modules/data-lifecycle/constants";
import { createDeletionRequest } from "@/modules/data-lifecycle/deletion-request.service";
import { endRelationship } from "@/modules/family-access/end-relationship.service";
import { createFamilyPush } from "@/modules/family-content/create-push.service";
import { FamilyContentError } from "@/modules/family-content/errors";
import { submitPushAnswer } from "@/modules/family-content/answer.service";
import {
  createPushComment,
  listPushComments,
  mutatePushComment,
} from "@/modules/family-content/comment.service";
import {
  editFamilyPush,
  getFamilyPush,
  listFamilyPushes,
  transitionFamilyPush,
} from "@/modules/family-content/push-lifecycle.service";
import { listActiveParentIdsForStudent } from "@/modules/family-access/authorization.service";
import { getParentOrStudentRole } from "@/modules/identity/user-role.service";
import { processNextOutboxEvent } from "@/modules/outbox/process-outbox-event.service";
import { replayDeadOutboxEvent } from "@/modules/outbox/replay-outbox-event.service";
import {
  acceptParentForStudent,
  bootstrapVerifiedParentWithInvite,
  seedStudentUser,
} from "../../helpers/family-access";
import {
  closeTestDb,
  createIndependentTestDb,
  getTestDb,
  migrateTestDb,
  resetIdentityTables,
} from "../../helpers/db";

config({ path: ".env.local" });
config({ path: ".env" });

const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("M7 family content P1", () => {
  const db = getTestDb();

  beforeAll(async () => {
    process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";
    await migrateTestDb();
  });

  beforeEach(async () => {
    await resetIdentityTables(db);
  });

  afterAll(async () => {
    await closeTestDb();
  });

  async function seedFamily() {
    const suffix = crypto.randomUUID().slice(0, 8);
    const { parentId: creatorId } = await bootstrapVerifiedParentWithInvite(
      db,
      `creator_${suffix}@test.local`,
    );
    const { parentId: otherParentId } = await bootstrapVerifiedParentWithInvite(
      db,
      `other_${suffix}@test.local`,
    );
    const student = await seedStudentUser(db, {
      username: `student_${suffix}`,
      password: "StudentPass123!Student",
    });
    const { relationshipId } = await acceptParentForStudent(db, {
      parentId: creatorId,
      studentId: student.studentId,
    });
    await acceptParentForStudent(db, {
      parentId: otherParentId,
      studentId: student.studentId,
    });
    return { suffix, creatorId, otherParentId, student, relationshipId };
  }

  async function drainOutbox(max = 20) {
    for (let i = 0; i < max; i += 1) {
      const result = await processNextOutboxEvent(db, { workerId: `m7-test-${i}` });
      if (!result.processed) {
        break;
      }
    }
  }

  it("migration constraints: status/content/version uniqueness", async () => {
    const { creatorId, student } = await seedFamily();
    const created = await createFamilyPush(db, {
      actorId: creatorId,
      studentId: student.studentId,
      body: "hello",
      publishMode: "draft",
      idempotencyKey: `create-draft-${crypto.randomUUID()}`,
    });

    await expect(
      db.insert(familyPushVersions).values({
        pushId: created.push.pushId,
        version: 1,
        body: "dup",
        linkUrl: null,
      }),
    ).rejects.toThrow();

    await expect(
      db.execute(sql`
        INSERT INTO family_pushes (
          student_id, creator_parent_id, status, current_version,
          create_idempotency_key, create_idempotency_payload_hash
        ) VALUES (
          ${student.studentId}::uuid, ${creatorId}::uuid, 'scheduled', 1,
          ${`bad-${crypto.randomUUID()}`}, 'hash'
        )
      `),
    ).rejects.toThrow();
  });

  it("AC-M7-01: create/edit/publish/cancel/disable/delete + idempotent replay", async () => {
    const { creatorId, student, suffix } = await seedFamily();
    const secret = `secret-body-${suffix}`;

    const created = await createFamilyPush(db, {
      actorId: creatorId,
      studentId: student.studentId,
      body: secret,
      linkUrl: "https://example.com/path",
      publishMode: "draft",
      idempotencyKey: `create-${suffix}`,
    });
    expect(created.push.status).toBe("draft");

    const replay = await createFamilyPush(db, {
      actorId: creatorId,
      studentId: student.studentId,
      body: secret,
      linkUrl: "https://example.com/path",
      publishMode: "draft",
      idempotencyKey: `create-${suffix}`,
    });
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.push.pushId).toBe(created.push.pushId);

    await expect(
      createFamilyPush(db, {
        actorId: creatorId,
        studentId: student.studentId,
        body: "different",
        publishMode: "draft",
        idempotencyKey: `create-${suffix}`,
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    const published = await transitionFamilyPush(db, {
      actorId: creatorId,
      pushId: created.push.pushId,
      action: "publish",
      idempotencyKey: `publish-${suffix}`,
    });
    expect(published.push.status).toBe("published");

    const disabled = await transitionFamilyPush(db, {
      actorId: creatorId,
      pushId: created.push.pushId,
      action: "disable",
      idempotencyKey: `disable-${suffix}`,
    });
    expect(disabled.push.status).toBe("disabled");

    const audits = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.resourceId, created.push.pushId));
    for (const audit of audits) {
      expect(JSON.stringify(audit.metadata ?? {})).not.toContain(secret);
      expect(JSON.stringify(audit.metadata ?? {})).not.toContain("https://example.com/path");
    }

    const outbox = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.aggregateId, created.push.pushId));
    for (const event of outbox) {
      expect(JSON.stringify(event.payload)).not.toContain(secret);
      expect(JSON.stringify(event.payload)).not.toContain("https://example.com/path");
    }
  });

  it("AC-M7-07: scheduled publish worker once + notification without body", async () => {
    const { creatorId, otherParentId, student, suffix } = await seedFamily();
    const secret = `scheduled-secret-${suffix}`;
    const when = new Date(Date.now() - 1_000);

    const created = await createFamilyPush(db, {
      actorId: creatorId,
      studentId: student.studentId,
      body: secret,
      publishMode: "scheduled",
      scheduledPublishAt: new Date(Date.now() + 60_000).toISOString(),
      idempotencyKey: `sched-${suffix}`,
    });

    await db
      .update(outboxEvents)
      .set({ availableAt: when })
      .where(eq(outboxEvents.dedupeKey, `family_push.publish_requested:${created.push.pushId}`));

    await drainOutbox();
    await drainOutbox();

    const [push] = await db
      .select()
      .from(familyPushes)
      .where(eq(familyPushes.id, created.push.pushId))
      .limit(1);
    expect(push?.status).toBe("published");

    const notifs = await db.select().from(notifications);
    expect(notifs.length).toBeGreaterThanOrEqual(3);
    for (const notif of notifs) {
      expect(JSON.stringify(notif)).not.toContain(secret);
      expect(notif.notificationType).toBe("family_push.published");
    }

    const recipientIds = new Set(notifs.map((n) => n.recipientUserId));
    expect(recipientIds.has(student.studentId)).toBe(true);
    expect(recipientIds.has(creatorId)).toBe(true);
    expect(recipientIds.has(otherParentId)).toBe(true);

    const publishedEvent = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.dedupeKey, `family_push.published:${created.push.pushId}`))
      .limit(1);
    expect(publishedEvent[0]?.status).toBe("processed");

    // Dead replay of publish_requested should not republish.
    await db
      .update(outboxEvents)
      .set({ status: "dead", attempts: 5 })
      .where(eq(outboxEvents.dedupeKey, `family_push.publish_requested:${created.push.pushId}`));

    await replayDeadOutboxEvent(db, {
      eventId: (
        await db
          .select()
          .from(outboxEvents)
          .where(eq(outboxEvents.dedupeKey, `family_push.publish_requested:${created.push.pushId}`))
          .limit(1)
      )[0]!.id,
      actorId: creatorId,
      reason: "test replay",
      idempotencyKey: `replay-${suffix}`,
    });
    await drainOutbox();

    const notifCount = (await db.select().from(notifications)).length;
    expect(notifCount).toBe(notifs.length);
  });

  it("AC-M7-02: ownership, other parent read-only, unrelated/forbidden, freeze, unlink", async () => {
    const { creatorId, otherParentId, student, relationshipId, suffix } = await seedFamily();
    const { parentId: strangerId } = await bootstrapVerifiedParentWithInvite(
      db,
      `stranger_${suffix}@test.local`,
    );

    const created = await createFamilyPush(db, {
      actorId: creatorId,
      studentId: student.studentId,
      body: "owned",
      publishMode: "immediate",
      idempotencyKey: `owned-${suffix}`,
    });

    const forOther = await getFamilyPush(db, {
      actorId: otherParentId,
      actorRole: "parent",
      pushId: created.push.pushId,
    });
    expect(forOther.canEdit).toBe(false);

    await expect(
      transitionFamilyPush(db, {
        actorId: otherParentId,
        pushId: created.push.pushId,
        action: "disable",
        idempotencyKey: `other-disable-${suffix}`,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await expect(
      getFamilyPush(db, {
        actorId: strangerId,
        actorRole: "parent",
        pushId: created.push.pushId,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const scheduled = await createFamilyPush(db, {
      actorId: creatorId,
      studentId: student.studentId,
      body: "will cancel on unlink",
      publishMode: "scheduled",
      scheduledPublishAt: new Date(Date.now() + 3_600_000).toISOString(),
      idempotencyKey: `unlink-sched-${suffix}`,
    });

    await endRelationship(db, {
      actorId: creatorId,
      relationshipId,
      idempotencyKey: `end-${suffix}`,
    });

    const [cancelled] = await db
      .select()
      .from(familyPushes)
      .where(eq(familyPushes.id, scheduled.push.pushId))
      .limit(1);
    expect(cancelled?.status).toBe("cancelled");

    await expect(
      getFamilyPush(db, {
        actorId: creatorId,
        actorRole: "parent",
        pushId: created.push.pushId,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const stillVisible = await getFamilyPush(db, {
      actorId: otherParentId,
      actorRole: "parent",
      pushId: created.push.pushId,
    });
    expect(stillVisible.status).toBe("published");

    // Freeze student blocks ordinary family content writes/reads.
    const { parentId: freezeParentId } = await bootstrapVerifiedParentWithInvite(
      db,
      `freeze_p_${suffix}@test.local`,
    );
    const freezeStudent = await seedStudentUser(db, {
      username: `freeze_s_${suffix}`,
      password: "StudentPass123!Student",
    });
    await acceptParentForStudent(db, {
      parentId: freezeParentId,
      studentId: freezeStudent.studentId,
    });
    await createDeletionRequest(db, {
      targetType: DELETION_TARGET_TYPE.STUDENT_ACCOUNT,
      targetId: freezeStudent.studentId,
      requestedBy: freezeStudent.studentId,
      requesterRole: "student",
      idempotencyKey: `freeze-${suffix}`,
    });

    await expect(
      createFamilyPush(db, {
        actorId: freezeParentId,
        studentId: freezeStudent.studentId,
        body: "blocked",
        publishMode: "immediate",
        idempotencyKey: `freeze-create-${suffix}`,
      }),
    ).rejects.toMatchObject({ code: "FROZEN" });
  });

  it("AC-M7-03/04: versioned answers and comments; no body in audit", async () => {
    const { creatorId, student, suffix } = await seedFamily();
    const answerSecret = `answer-${suffix}`;
    const commentSecret = `comment-${suffix}`;

    const created = await createFamilyPush(db, {
      actorId: creatorId,
      studentId: student.studentId,
      body: "question",
      publishMode: "immediate",
      idempotencyKey: `q-${suffix}`,
    });

    const a1 = await submitPushAnswer(db, {
      studentId: student.studentId,
      pushId: created.push.pushId,
      body: answerSecret,
      idempotencyKey: `ans1-${suffix}`,
    });
    expect(a1.answer.currentVersion).toBe(1);

    const a2 = await submitPushAnswer(db, {
      studentId: student.studentId,
      pushId: created.push.pushId,
      body: `${answerSecret}-v2`,
      idempotencyKey: `ans2-${suffix}`,
    });
    expect(a2.answer.currentVersion).toBe(2);
    expect(a2.answer.body).toBe(`${answerSecret}-v2`);

    const versions = await db
      .select()
      .from(pushAnswerVersions)
      .where(eq(pushAnswerVersions.answerId, a1.answer.answerId));
    expect(versions).toHaveLength(2);

    await expect(
      submitPushAnswer(db, {
        studentId: creatorId,
        pushId: created.push.pushId,
        body: "parent cannot answer",
        idempotencyKey: `ans-parent-${suffix}`,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const comment = await createPushComment(db, {
      actorId: creatorId,
      actorRole: "parent",
      pushId: created.push.pushId,
      body: commentSecret,
      idempotencyKey: `c1-${suffix}`,
    });

    const reply = await createPushComment(db, {
      actorId: student.studentId,
      actorRole: "student",
      pushId: created.push.pushId,
      body: "student reply",
      parentCommentId: comment.comment.commentId,
      idempotencyKey: `c2-${suffix}`,
    });
    expect(reply.comment.parentCommentId).toBe(comment.comment.commentId);

    await mutatePushComment(db, {
      actorId: creatorId,
      commentId: comment.comment.commentId,
      body: `${commentSecret}-edited`,
      idempotencyKey: `cedit-${suffix}`,
    });

    await mutatePushComment(db, {
      actorId: creatorId,
      commentId: comment.comment.commentId,
      delete: true,
      idempotencyKey: `cdel-${suffix}`,
    });

    const listed = await listPushComments(db, {
      actorId: student.studentId,
      actorRole: "student",
      pushId: created.push.pushId,
    });
    const deleted = listed.find((c) => c.commentId === comment.comment.commentId);
    expect(deleted?.deleted).toBe(true);
    expect(deleted?.body).toBeNull();

    await expect(
      mutatePushComment(db, {
        actorId: student.studentId,
        commentId: comment.comment.commentId,
        body: "hijack",
        idempotencyKey: `hijack-${suffix}`,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await transitionFamilyPush(db, {
      actorId: creatorId,
      pushId: created.push.pushId,
      action: "disable",
      idempotencyKey: `dis-${suffix}`,
    });

    await expect(
      submitPushAnswer(db, {
        studentId: student.studentId,
        pushId: created.push.pushId,
        body: "after disable",
        idempotencyKey: `ans-after-${suffix}`,
      }),
    ).rejects.toMatchObject({ code: "STATE_CONFLICT" });

    const allAudits = await db.select().from(auditEvents);
    for (const audit of allAudits) {
      const blob = JSON.stringify(audit);
      expect(blob).not.toContain(answerSecret);
      expect(blob).not.toContain(commentSecret);
    }
  });

  it("concurrent publish vs cancel resolves deterministically", async () => {
    const { creatorId, student, suffix } = await seedFamily();
    const created = await createFamilyPush(db, {
      actorId: creatorId,
      studentId: student.studentId,
      body: "race",
      publishMode: "scheduled",
      scheduledPublishAt: new Date(Date.now() + 3_600_000).toISOString(),
      idempotencyKey: `race-${suffix}`,
    });

    const indepA = createIndependentTestDb();
    const indepB = createIndependentTestDb();
    try {
      const results = await Promise.allSettled([
        transitionFamilyPush(indepA.db, {
          actorId: creatorId,
          pushId: created.push.pushId,
          action: "publish",
          idempotencyKey: `race-pub-${suffix}`,
        }),
        transitionFamilyPush(indepB.db, {
          actorId: creatorId,
          pushId: created.push.pushId,
          action: "cancel",
          idempotencyKey: `race-cancel-${suffix}`,
        }),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(FamilyContentError);

      const [finalPush] = await db
        .select()
        .from(familyPushes)
        .where(eq(familyPushes.id, created.push.pushId))
        .limit(1);
      expect(["published", "cancelled"]).toContain(finalPush?.status);
    } finally {
      await indepA.close();
      await indepB.close();
    }
  });

  it("list student vs parent visibility", async () => {
    const { creatorId, student, suffix } = await seedFamily();
    await createFamilyPush(db, {
      actorId: creatorId,
      studentId: student.studentId,
      body: "draft only",
      publishMode: "draft",
      idempotencyKey: `draft-vis-${suffix}`,
    });
    await createFamilyPush(db, {
      actorId: creatorId,
      studentId: student.studentId,
      body: "published",
      publishMode: "immediate",
      idempotencyKey: `pub-vis-${suffix}`,
    });

    const parentList = await listFamilyPushes(db, {
      actorId: creatorId,
      actorRole: "parent",
      studentId: student.studentId,
    });
    expect(parentList.some((p) => p.status === "draft")).toBe(true);

    const studentList = await listFamilyPushes(db, {
      actorId: student.studentId,
      actorRole: "student",
      studentId: student.studentId,
    });
    expect(studentList.every((p) => p.status === "published" || p.status === "disabled")).toBe(
      true,
    );
    expect(studentList.some((p) => p.status === "draft")).toBe(false);
  });

  it("P1-F01: edit/transition/comment mutate idempotency payload conflicts", async () => {
    const { creatorId, student, suffix } = await seedFamily();
    const draft = await createFamilyPush(db, {
      actorId: creatorId,
      studentId: student.studentId,
      body: "v1",
      linkUrl: "https://example.com/a",
      publishMode: "draft",
      idempotencyKey: `f01-create-${suffix}`,
    });

    const edited = await editFamilyPush(db, {
      actorId: creatorId,
      pushId: draft.push.pushId,
      body: "v2",
      linkUrl: "https://example.com/a",
      idempotencyKey: `f01-shared-${suffix}`,
    });
    expect(edited.push.body).toBe("v2");

    const editReplay = await editFamilyPush(db, {
      actorId: creatorId,
      pushId: draft.push.pushId,
      body: "v2",
      linkUrl: "https://example.com/a",
      idempotencyKey: `f01-shared-${suffix}`,
    });
    expect(editReplay.idempotentReplay).toBe(true);

    await expect(
      editFamilyPush(db, {
        actorId: creatorId,
        pushId: draft.push.pushId,
        body: "different",
        linkUrl: "https://example.com/a",
        idempotencyKey: `f01-shared-${suffix}`,
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    // Same client key + different command (publish) must conflict — action not in key.
    await expect(
      transitionFamilyPush(db, {
        actorId: creatorId,
        pushId: draft.push.pushId,
        action: "publish",
        idempotencyKey: `f01-shared-${suffix}`,
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    const published = await transitionFamilyPush(db, {
      actorId: creatorId,
      pushId: draft.push.pushId,
      action: "publish",
      idempotencyKey: `f01-pub-${suffix}`,
    });
    expect(published.push.status).toBe("published");

    const pubReplay = await transitionFamilyPush(db, {
      actorId: creatorId,
      pushId: draft.push.pushId,
      action: "publish",
      idempotencyKey: `f01-pub-${suffix}`,
    });
    expect(pubReplay.idempotentReplay).toBe(true);

    await expect(
      transitionFamilyPush(db, {
        actorId: creatorId,
        pushId: draft.push.pushId,
        action: "delete",
        idempotencyKey: `f01-pub-${suffix}`,
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    const comment = await createPushComment(db, {
      actorId: creatorId,
      actorRole: "parent",
      pushId: draft.push.pushId,
      body: "c1",
      idempotencyKey: `f01-ccreate-${suffix}`,
    });

    const editedComment = await mutatePushComment(db, {
      actorId: creatorId,
      commentId: comment.comment.commentId,
      body: "c1-edit",
      idempotencyKey: `f01-cmutate-${suffix}`,
    });
    expect(editedComment.comment.body).toBe("c1-edit");

    const commentReplay = await mutatePushComment(db, {
      actorId: creatorId,
      commentId: comment.comment.commentId,
      body: "c1-edit",
      idempotencyKey: `f01-cmutate-${suffix}`,
    });
    expect(commentReplay.idempotentReplay).toBe(true);

    await expect(
      mutatePushComment(db, {
        actorId: creatorId,
        commentId: comment.comment.commentId,
        body: "other-body",
        idempotencyKey: `f01-cmutate-${suffix}`,
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    await expect(
      mutatePushComment(db, {
        actorId: creatorId,
        commentId: comment.comment.commentId,
        delete: true,
        idempotencyKey: `f01-cmutate-${suffix}`,
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    const deleted = await mutatePushComment(db, {
      actorId: creatorId,
      commentId: comment.comment.commentId,
      delete: true,
      idempotencyKey: `f01-cdel-${suffix}`,
    });
    expect(deleted.comment.deleted).toBe(true);

    const deleteReplay = await mutatePushComment(db, {
      actorId: creatorId,
      commentId: comment.comment.commentId,
      delete: true,
      idempotencyKey: `f01-cdel-${suffix}`,
    });
    expect(deleteReplay.idempotentReplay).toBe(true);
  });

  it("P1-F02: scheduled publish and auto-cancel write audit/outbox atomically", async () => {
    const { creatorId, student, suffix, relationshipId } = await seedFamily();
    const secret = `worker-secret-${suffix}`;

    const scheduled = await createFamilyPush(db, {
      actorId: creatorId,
      studentId: student.studentId,
      body: secret,
      publishMode: "scheduled",
      scheduledPublishAt: new Date(Date.now() + 60_000).toISOString(),
      idempotencyKey: `f02-sched-${suffix}`,
    });

    await db
      .update(outboxEvents)
      .set({ availableAt: new Date(Date.now() - 1_000) })
      .where(eq(outboxEvents.dedupeKey, `family_push.publish_requested:${scheduled.push.pushId}`));

    await drainOutbox();
    await drainOutbox();

    const publishAudits = await db
      .select()
      .from(auditEvents)
      .where(
        eq(auditEvents.idempotencyKey, `audit:family-push-worker-publish:${scheduled.push.pushId}`),
      );
    expect(publishAudits).toHaveLength(1);
    expect(JSON.stringify(publishAudits[0]?.metadata ?? {})).not.toContain(secret);

    const publishedOutbox = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.dedupeKey, `family_push.published:${scheduled.push.pushId}`));
    expect(publishedOutbox).toHaveLength(1);
    expect(JSON.stringify(publishedOutbox[0]?.payload ?? {})).not.toContain(secret);

    // Frozen auto-cancel path.
    const freezeParent = await bootstrapVerifiedParentWithInvite(
      db,
      `f02_freeze_p_${suffix}@test.local`,
    );
    const freezeStudent = await seedStudentUser(db, {
      username: `f02_freeze_s_${suffix}`,
      password: "StudentPass123!Student",
    });
    await acceptParentForStudent(db, {
      parentId: freezeParent.parentId,
      studentId: freezeStudent.studentId,
    });
    const freezeSched = await createFamilyPush(db, {
      actorId: freezeParent.parentId,
      studentId: freezeStudent.studentId,
      body: `freeze-${secret}`,
      publishMode: "scheduled",
      scheduledPublishAt: new Date(Date.now() + 60_000).toISOString(),
      idempotencyKey: `f02-freeze-sched-${suffix}`,
    });
    await createDeletionRequest(db, {
      targetType: DELETION_TARGET_TYPE.STUDENT_ACCOUNT,
      targetId: freezeStudent.studentId,
      requestedBy: freezeStudent.studentId,
      requesterRole: "student",
      idempotencyKey: `f02-freeze-${suffix}`,
    });
    await db
      .update(outboxEvents)
      .set({ availableAt: new Date(Date.now() - 1_000) })
      .where(
        eq(outboxEvents.dedupeKey, `family_push.publish_requested:${freezeSched.push.pushId}`),
      );
    await drainOutbox();

    const [frozenPush] = await db
      .select()
      .from(familyPushes)
      .where(eq(familyPushes.id, freezeSched.push.pushId))
      .limit(1);
    expect(frozenPush?.status).toBe("cancelled");

    const freezeAudits = await db
      .select()
      .from(auditEvents)
      .where(
        eq(
          auditEvents.idempotencyKey,
          `audit:family-push-worker-cancel:${freezeSched.push.pushId}`,
        ),
      );
    expect(freezeAudits).toHaveLength(1);
    expect((freezeAudits[0]?.metadata as { reason?: string } | null)?.reason).toBe("frozen");
    expect(JSON.stringify(freezeAudits[0]?.metadata ?? {})).not.toContain(`freeze-${secret}`);

    const freezeCancelledOutbox = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.dedupeKey, `family_push.cancelled:${freezeSched.push.pushId}`));
    expect(freezeCancelledOutbox).toHaveLength(1);
    expect(JSON.stringify(freezeCancelledOutbox[0]?.payload ?? {})).not.toContain(
      `freeze-${secret}`,
    );

    // Relationship-inactive auto-cancel path.
    const unlinkSched = await createFamilyPush(db, {
      actorId: creatorId,
      studentId: student.studentId,
      body: `unlink-${secret}`,
      publishMode: "scheduled",
      scheduledPublishAt: new Date(Date.now() + 60_000).toISOString(),
      idempotencyKey: `f02-unlink-sched-${suffix}`,
    });
    await endRelationship(db, {
      actorId: creatorId,
      relationshipId,
      idempotencyKey: `f02-end-${suffix}`,
    });
    // Recreate relationship for other flows? Not needed. Force worker on remaining scheduled.
    // Relationship end already cancelled creator scheduled pushes; create another with inactive check:
    // Re-link creator then create schedule, then end again via direct status trick —
    // Instead: seed a push while active, then end relationship before worker (already cancelled by end).
    // For worker path with relationship_inactive: create push, manually set relationship ended
    // without cancelScheduled helper by using a second parent-owned schedule after end.

    const { parentId: inactiveParent } = await bootstrapVerifiedParentWithInvite(
      db,
      `f02_inactive_p_${suffix}@test.local`,
    );
    const inactiveStudent = await seedStudentUser(db, {
      username: `f02_inactive_s_${suffix}`,
      password: "StudentPass123!Student",
    });
    const { relationshipId: inactiveRel } = await acceptParentForStudent(db, {
      parentId: inactiveParent,
      studentId: inactiveStudent.studentId,
    });
    const inactiveSched = await createFamilyPush(db, {
      actorId: inactiveParent,
      studentId: inactiveStudent.studentId,
      body: `inactive-${secret}`,
      publishMode: "scheduled",
      scheduledPublishAt: new Date(Date.now() + 60_000).toISOString(),
      idempotencyKey: `f02-inactive-sched-${suffix}`,
    });
    // End relationship but leave the push scheduled by updating status back for worker path.
    await endRelationship(db, {
      actorId: inactiveParent,
      relationshipId: inactiveRel,
      idempotencyKey: `f02-inactive-end-${suffix}`,
    });
    await db
      .update(familyPushes)
      .set({ status: "scheduled" })
      .where(eq(familyPushes.id, inactiveSched.push.pushId));
    await db
      .update(outboxEvents)
      .set({ availableAt: new Date(Date.now() - 1_000), status: "pending" })
      .where(
        eq(outboxEvents.dedupeKey, `family_push.publish_requested:${inactiveSched.push.pushId}`),
      );
    await drainOutbox();

    const [inactivePush] = await db
      .select()
      .from(familyPushes)
      .where(eq(familyPushes.id, inactiveSched.push.pushId))
      .limit(1);
    expect(inactivePush?.status).toBe("cancelled");

    const inactiveAudits = await db
      .select()
      .from(auditEvents)
      .where(
        eq(
          auditEvents.idempotencyKey,
          `audit:family-push-worker-cancel:${inactiveSched.push.pushId}`,
        ),
      );
    expect(inactiveAudits).toHaveLength(1);
    expect((inactiveAudits[0]?.metadata as { reason?: string } | null)?.reason).toBe(
      "relationship_inactive",
    );

    // Dead replay of publish_requested must not duplicate audit/outbox/notifications for published push.
    const notifBefore = (await db.select().from(notifications)).length;
    await db
      .update(outboxEvents)
      .set({ status: "dead", attempts: 5 })
      .where(eq(outboxEvents.dedupeKey, `family_push.publish_requested:${scheduled.push.pushId}`));
    await replayDeadOutboxEvent(db, {
      eventId: (
        await db
          .select()
          .from(outboxEvents)
          .where(
            eq(outboxEvents.dedupeKey, `family_push.publish_requested:${scheduled.push.pushId}`),
          )
          .limit(1)
      )[0]!.id,
      actorId: creatorId,
      reason: "f02 replay",
      idempotencyKey: `f02-replay-${suffix}`,
    });
    await drainOutbox();
    expect(
      (
        await db
          .select()
          .from(auditEvents)
          .where(
            eq(
              auditEvents.idempotencyKey,
              `audit:family-push-worker-publish:${scheduled.push.pushId}`,
            ),
          )
      ).length,
    ).toBe(1);
    expect(
      (
        await db
          .select()
          .from(outboxEvents)
          .where(eq(outboxEvents.dedupeKey, `family_push.published:${scheduled.push.pushId}`))
      ).length,
    ).toBe(1);
    expect((await db.select().from(notifications)).length).toBe(notifBefore);

    void unlinkSched;
  });

  it("P1-F03: family-access/identity interfaces own relationship and role reads", async () => {
    const { creatorId, otherParentId, student } = await seedFamily();
    const parentIds = await listActiveParentIdsForStudent(db, student.studentId);
    expect(parentIds.sort()).toEqual([creatorId, otherParentId].sort());

    await expect(getParentOrStudentRole(db, creatorId)).resolves.toBe("parent");
    await expect(getParentOrStudentRole(db, student.studentId)).resolves.toBe("student");
  });
});
