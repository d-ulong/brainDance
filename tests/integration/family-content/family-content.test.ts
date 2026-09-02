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
  relationships,
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
import { loadUserRole } from "@/modules/family-content/access";
import { listActiveParentIdsForStudent } from "@/modules/family-access/authorization.service";
import { getParentOrStudentRole } from "@/modules/identity/user-role.service";
import { processOutboxEventById } from "@/modules/outbox/process-outbox-event.service";
import { replayDeadOutboxEvent } from "@/modules/outbox/replay-outbox-event.service";
import { isPostgresUniqueViolation } from "@/lib/postgres-errors";
import {
  acceptParentForStudent,
  bootstrapVerifiedParentWithInvite,
  seedStudentUser,
} from "../../helpers/family-access";
import { bootstrapAdmin } from "../../helpers/identity";
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

  /**
   * Process only the tracked target outbox row (by dedupeKey).
   * Accelerates pending availableAt only; never clears an active lease.
   */
  async function processTargetOutboxUntil(
    dedupeKey: string,
    predicate: () => Promise<boolean>,
    maxSteps = 12,
  ) {
    const due = new Date(Date.now() - 60_000);
    const activeLeasePollMs = 25;
    const activeLeasePollLimit = 8;

    for (let i = 0; i < maxSteps; i += 1) {
      if (await predicate()) {
        return;
      }

      const [target] = await db
        .select({
          id: outboxEvents.id,
          status: outboxEvents.status,
          availableAt: outboxEvents.availableAt,
          leasedUntil: outboxEvents.leasedUntil,
        })
        .from(outboxEvents)
        .where(eq(outboxEvents.dedupeKey, dedupeKey))
        .limit(1);

      if (!target) {
        // Follow-up event may not be inserted yet; keep polling without touching other rows.
        continue;
      }

      if (target.status === "pending") {
        const availableAt = target.availableAt ? new Date(target.availableAt) : null;
        if (availableAt && availableAt.getTime() > Date.now()) {
          await db
            .update(outboxEvents)
            .set({ availableAt: due })
            .where(eq(outboxEvents.id, target.id));
        }

        await processOutboxEventById(db, {
          eventId: target.id,
          workerId: `m7-target-${dedupeKey.slice(-8)}-${i}`,
          now: new Date(),
        });
        continue;
      }

      if (target.status === "leased") {
        const leasedUntil = target.leasedUntil ? new Date(target.leasedUntil) : null;
        const now = Date.now();
        if (leasedUntil && leasedUntil.getTime() > now) {
          let stillActive = true;
          for (let poll = 0; poll < activeLeasePollLimit; poll += 1) {
            await new Promise((resolve) => setTimeout(resolve, activeLeasePollMs));
            if (await predicate()) {
              return;
            }
            const [again] = await db
              .select({
                status: outboxEvents.status,
                leasedUntil: outboxEvents.leasedUntil,
              })
              .from(outboxEvents)
              .where(eq(outboxEvents.id, target.id))
              .limit(1);
            if (!again || again.status !== "leased") {
              stillActive = false;
              break;
            }
            const until = again.leasedUntil ? new Date(again.leasedUntil).getTime() : 0;
            if (until <= Date.now()) {
              stillActive = false;
              break;
            }
          }
          if (stillActive) {
            throw new Error(
              `Target outbox ${dedupeKey} remains leased by another worker; refusing to clear active lease`,
            );
          }
          continue;
        }

        // Expired lease: reclaim via formal claim-by-id rules (no forced pending rewrite).
        await processOutboxEventById(db, {
          eventId: target.id,
          workerId: `m7-target-${dedupeKey.slice(-8)}-${i}`,
          now: new Date(),
        });
        continue;
      }

      // Already processed/dead: re-check predicate on next iteration without mutating other events.
    }

    expect(await predicate()).toBe(true);
  }

  function assertNoUniqueViolationLeak(reason: unknown) {
    expect(isPostgresUniqueViolation(reason)).toBe(false);
    const message = reason instanceof Error ? reason.message : String(reason);
    expect(message).not.toMatch(/unique|duplicate key|23505/i);
  }

  async function assertPushStatus(pushId: string, status: string) {
    const [push] = await db.select().from(familyPushes).where(eq(familyPushes.id, pushId)).limit(1);
    return push?.status === status;
  }

  async function replayDeadOnce(dedupeKey: string, actorId: string, suffix: string) {
    const [event] = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.dedupeKey, dedupeKey))
      .limit(1);
    expect(event).toBeTruthy();
    await db
      .update(outboxEvents)
      .set({ status: "dead", attempts: 5 })
      .where(eq(outboxEvents.id, event!.id));
    await replayDeadOutboxEvent(db, {
      eventId: event!.id,
      actorId,
      reason: "test replay",
      idempotencyKey: `replay-${suffix}-${dedupeKey.slice(-8)}`,
    });
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

    const created = await createFamilyPush(db, {
      actorId: creatorId,
      studentId: student.studentId,
      body: secret,
      publishMode: "scheduled",
      scheduledPublishAt: new Date(Date.now() + 60_000).toISOString(),
      idempotencyKey: `sched-${suffix}`,
    });
    const pushId = created.push.pushId;
    const requestedKey = `family_push.publish_requested:${pushId}`;
    const publishedKey = `family_push.published:${pushId}`;

    await processTargetOutboxUntil(requestedKey, () => assertPushStatus(pushId, "published"));
    await processTargetOutboxUntil(publishedKey, async () => {
      const rows = await db.select().from(notifications);
      return rows.length >= 3;
    });

    const [push] = await db
      .select()
      .from(familyPushes)
      .where(eq(familyPushes.id, pushId))
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
      .where(eq(outboxEvents.dedupeKey, publishedKey))
      .limit(1);
    expect(publishedEvent[0]?.status).toBe("processed");

    await replayDeadOnce(requestedKey, creatorId, suffix);
    await processTargetOutboxUntil(requestedKey, () => assertPushStatus(pushId, "published"));

    const notifCount = (await db.select().from(notifications)).length;
    expect(notifCount).toBe(notifs.length);
    expect(
      (
        await db
          .select()
          .from(auditEvents)
          .where(eq(auditEvents.idempotencyKey, `audit:family-push-worker-publish:${pushId}`))
      ).length,
    ).toBe(1);
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

  it("C1: concurrent same-key replay and different-payload conflict", async () => {
    const { creatorId, student, suffix } = await seedFamily();
    const draft = await createFamilyPush(db, {
      actorId: creatorId,
      studentId: student.studentId,
      body: "c1-v1",
      publishMode: "draft",
      idempotencyKey: `c1-create-${suffix}`,
    });

    const indepA = createIndependentTestDb();
    const indepB = createIndependentTestDb();
    try {
      const editKey = `c1-edit-${suffix}`;
      const editResults = await Promise.allSettled([
        editFamilyPush(indepA.db, {
          actorId: creatorId,
          pushId: draft.push.pushId,
          body: "c1-v2",
          idempotencyKey: editKey,
        }),
        editFamilyPush(indepB.db, {
          actorId: creatorId,
          pushId: draft.push.pushId,
          body: "c1-v2",
          idempotencyKey: editKey,
        }),
      ]);
      const editFulfilled = editResults.filter((r) => r.status === "fulfilled");
      expect(editFulfilled).toHaveLength(2);
      const editWrites = editFulfilled.filter(
        (r) => r.status === "fulfilled" && !r.value.idempotentReplay,
      );
      const editReplays = editFulfilled.filter(
        (r) => r.status === "fulfilled" && r.value.idempotentReplay,
      );
      expect(editWrites).toHaveLength(1);
      expect(editReplays).toHaveLength(1);

      // Different resources reusing one brand-new key must not leak Postgres unique violations.
      const draftAlt = await createFamilyPush(db, {
        actorId: creatorId,
        studentId: student.studentId,
        body: "c1-alt",
        publishMode: "draft",
        idempotencyKey: `c1-create-alt-${suffix}`,
      });
      const crossResourceKey = `c1-cross-resource-${suffix}`;
      const crossResults = await Promise.allSettled([
        editFamilyPush(indepA.db, {
          actorId: creatorId,
          pushId: draft.push.pushId,
          body: "c1-cross-a",
          idempotencyKey: crossResourceKey,
        }),
        editFamilyPush(indepB.db, {
          actorId: creatorId,
          pushId: draftAlt.push.pushId,
          body: "c1-cross-b",
          idempotencyKey: crossResourceKey,
        }),
      ]);
      for (const result of crossResults) {
        if (result.status === "rejected") {
          assertNoUniqueViolationLeak(result.reason);
          expect(result.reason).toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
        } else {
          expect(result.value.idempotentReplay).toBe(false);
        }
      }
      expect(crossResults.every((r) => r.status === "fulfilled" || r.status === "rejected")).toBe(
        true,
      );

      // Fresh key never present in audit: same resource, concurrent different payload/action.
      // Lock order (FOR UPDATE push row → in-tx audit replay) serializes writers:
      // exactly one write succeeds; the other must be IDEMPOTENCY_CONFLICT (not unique-violation).
      const raceDraft = await createFamilyPush(db, {
        actorId: creatorId,
        studentId: student.studentId,
        body: "c1-race-base",
        publishMode: "draft",
        idempotencyKey: `c1-create-race-${suffix}`,
      });
      const freshDiffKey = `c1-fresh-diff-${suffix}`;
      const freshDiffResults = await Promise.allSettled([
        editFamilyPush(indepA.db, {
          actorId: creatorId,
          pushId: raceDraft.push.pushId,
          body: "c1-fresh-a",
          idempotencyKey: freshDiffKey,
        }),
        transitionFamilyPush(indepB.db, {
          actorId: creatorId,
          pushId: raceDraft.push.pushId,
          action: "publish",
          idempotencyKey: freshDiffKey,
        }),
      ]);
      const freshDiffFulfilled = freshDiffResults.filter((r) => r.status === "fulfilled");
      const freshDiffRejected = freshDiffResults.filter((r) => r.status === "rejected");
      expect(freshDiffFulfilled.length + freshDiffRejected.length).toBe(2);
      expect(freshDiffFulfilled.length).toBeGreaterThanOrEqual(1);
      expect(freshDiffRejected.length).toBeGreaterThanOrEqual(1);
      for (const result of freshDiffRejected) {
        assertNoUniqueViolationLeak((result as PromiseRejectedResult).reason);
        expect((result as PromiseRejectedResult).reason).toMatchObject({
          code: "IDEMPOTENCY_CONFLICT",
        });
      }
      for (const result of freshDiffFulfilled) {
        expect(result.status).toBe("fulfilled");
        expect(result.value.idempotentReplay).toBe(false);
      }

      const published = await transitionFamilyPush(db, {
        actorId: creatorId,
        pushId: draft.push.pushId,
        action: "publish",
        idempotencyKey: `c1-pub-${suffix}`,
      });
      expect(published.push.status).toBe("published");

      const comment = await createPushComment(db, {
        actorId: creatorId,
        actorRole: "parent",
        pushId: draft.push.pushId,
        body: "c1-comment",
        idempotencyKey: `c1-ccreate-${suffix}`,
      });
      const mutateKey = `c1-cmutate-${suffix}`;
      const mutateResults = await Promise.allSettled([
        mutatePushComment(indepA.db, {
          actorId: creatorId,
          commentId: comment.comment.commentId,
          body: "c1-comment-v2",
          idempotencyKey: mutateKey,
        }),
        mutatePushComment(indepB.db, {
          actorId: creatorId,
          commentId: comment.comment.commentId,
          body: "c1-comment-v2",
          idempotencyKey: mutateKey,
        }),
      ]);
      const mutateFulfilled = mutateResults.filter((r) => r.status === "fulfilled");
      expect(mutateFulfilled).toHaveLength(2);
      expect(
        mutateFulfilled.filter((r) => r.status === "fulfilled" && !r.value.idempotentReplay),
      ).toHaveLength(1);
      expect(
        mutateFulfilled.filter((r) => r.status === "fulfilled" && r.value.idempotentReplay),
      ).toHaveLength(1);

      // Fresh mutate key: concurrent different action (edit vs delete) on same comment.
      const freshMutateKey = `c1-fresh-cmutate-${suffix}`;
      const freshMutateResults = await Promise.allSettled([
        mutatePushComment(indepA.db, {
          actorId: creatorId,
          commentId: comment.comment.commentId,
          body: "c1-comment-fresh",
          idempotencyKey: freshMutateKey,
        }),
        mutatePushComment(indepB.db, {
          actorId: creatorId,
          commentId: comment.comment.commentId,
          delete: true,
          idempotencyKey: freshMutateKey,
        }),
      ]);
      const freshMutateFulfilled = freshMutateResults.filter((r) => r.status === "fulfilled");
      const freshMutateRejected = freshMutateResults.filter((r) => r.status === "rejected");
      expect(freshMutateFulfilled.length).toBeGreaterThanOrEqual(1);
      expect(freshMutateRejected.length).toBeGreaterThanOrEqual(1);
      for (const result of freshMutateRejected) {
        assertNoUniqueViolationLeak((result as PromiseRejectedResult).reason);
        expect((result as PromiseRejectedResult).reason).toMatchObject({
          code: "IDEMPOTENCY_CONFLICT",
        });
      }

      const pubKey = `c1-pub-race-${suffix}`;
      const draft2 = await createFamilyPush(db, {
        actorId: creatorId,
        studentId: student.studentId,
        body: "c1-draft2",
        publishMode: "draft",
        idempotencyKey: `c1-create2-${suffix}`,
      });
      const transitionSame = await Promise.allSettled([
        transitionFamilyPush(indepA.db, {
          actorId: creatorId,
          pushId: draft2.push.pushId,
          action: "publish",
          idempotencyKey: pubKey,
        }),
        transitionFamilyPush(indepB.db, {
          actorId: creatorId,
          pushId: draft2.push.pushId,
          action: "publish",
          idempotencyKey: pubKey,
        }),
      ]);
      const transitionFulfilled = transitionSame.filter((r) => r.status === "fulfilled");
      expect(transitionFulfilled).toHaveLength(2);
      expect(
        transitionFulfilled.filter((r) => r.status === "fulfilled" && !r.value.idempotentReplay),
      ).toHaveLength(1);
      expect(
        transitionFulfilled.filter((r) => r.status === "fulfilled" && r.value.idempotentReplay),
      ).toHaveLength(1);
    } finally {
      await indepA.close();
      await indepB.close();
    }
  });

  it("P1-F02: scheduled publish and auto-cancel write audit/outbox atomically", async () => {
    const { creatorId, student, suffix } = await seedFamily();
    const secret = `worker-secret-${suffix}`;

    const scheduled = await createFamilyPush(db, {
      actorId: creatorId,
      studentId: student.studentId,
      body: secret,
      publishMode: "scheduled",
      scheduledPublishAt: new Date(Date.now() + 60_000).toISOString(),
      idempotencyKey: `f02-sched-${suffix}`,
    });
    const scheduledId = scheduled.push.pushId;
    const scheduledRequestedKey = `family_push.publish_requested:${scheduledId}`;

    await processTargetOutboxUntil(scheduledRequestedKey, () =>
      assertPushStatus(scheduledId, "published"),
    );
    await processTargetOutboxUntil(`family_push.published:${scheduledId}`, async () => {
      const rows = await db
        .select()
        .from(outboxEvents)
        .where(eq(outboxEvents.dedupeKey, `family_push.published:${scheduledId}`));
      return rows[0]?.status === "processed";
    });

    const publishAudits = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.idempotencyKey, `audit:family-push-worker-publish:${scheduledId}`));
    expect(publishAudits).toHaveLength(1);
    expect(JSON.stringify(publishAudits[0]?.metadata ?? {})).not.toContain(secret);

    const publishedOutbox = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.dedupeKey, `family_push.published:${scheduledId}`));
    expect(publishedOutbox).toHaveLength(1);
    expect(JSON.stringify(publishedOutbox[0]?.payload ?? {})).not.toContain(secret);

    // Frozen auto-cancel: freeze leaves push scheduled; worker cancels on realtime check.
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
    const freezeId = freezeSched.push.pushId;
    const freezeRequestedKey = `family_push.publish_requested:${freezeId}`;
    const freezeCancelAuditKey = `audit:family-push-worker-cancel:${freezeId}`;
    const freezeCancelledKey = `family_push.cancelled:${freezeId}`;

    await createDeletionRequest(db, {
      targetType: DELETION_TARGET_TYPE.STUDENT_ACCOUNT,
      targetId: freezeStudent.studentId,
      requestedBy: freezeStudent.studentId,
      requesterRole: "student",
      idempotencyKey: `f02-freeze-${suffix}`,
    });

    expect(await assertPushStatus(freezeId, "scheduled")).toBe(true);
    await processTargetOutboxUntil(freezeRequestedKey, () => assertPushStatus(freezeId, "cancelled"));

    const freezeAudits = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.idempotencyKey, freezeCancelAuditKey));
    expect(freezeAudits).toHaveLength(1);
    expect((freezeAudits[0]?.metadata as { reason?: string } | null)?.reason).toBe("frozen");
    expect(JSON.stringify(freezeAudits[0]?.metadata ?? {})).not.toContain(`freeze-${secret}`);

    const freezeCancelledOutbox = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.dedupeKey, freezeCancelledKey));
    expect(freezeCancelledOutbox).toHaveLength(1);
    expect(JSON.stringify(freezeCancelledOutbox[0]?.payload ?? {})).not.toContain(
      `freeze-${secret}`,
    );

    await processTargetOutboxUntil(freezeCancelledKey, async () => {
      const [row] = await db
        .select()
        .from(outboxEvents)
        .where(eq(outboxEvents.dedupeKey, freezeCancelledKey))
        .limit(1);
      return row?.status === "processed";
    });

    const freezeNotifBeforeReplay = (await db.select().from(notifications)).length;
    await replayDeadOnce(freezeRequestedKey, freezeParent.parentId, `freeze-${suffix}`);
    await processTargetOutboxUntil(freezeRequestedKey, () => assertPushStatus(freezeId, "cancelled"));
    expect(
      (await db.select().from(auditEvents).where(eq(auditEvents.idempotencyKey, freezeCancelAuditKey)))
        .length,
    ).toBe(1);
    expect(
      (await db.select().from(outboxEvents).where(eq(outboxEvents.dedupeKey, freezeCancelledKey)))
        .length,
    ).toBe(1);
    expect((await db.select().from(notifications)).length).toBe(freezeNotifBeforeReplay);
    for (const notif of await db.select().from(notifications)) {
      expect(JSON.stringify(notif)).not.toContain(`freeze-${secret}`);
    }

    // Relationship-inactive: mark relationship ended without endRelationship cancel helper,
    // leaving the scheduled push intact for Worker realtime check.
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
    const inactiveId = inactiveSched.push.pushId;
    const inactiveRequestedKey = `family_push.publish_requested:${inactiveId}`;
    const inactiveCancelAuditKey = `audit:family-push-worker-cancel:${inactiveId}`;
    const inactiveCancelledKey = `family_push.cancelled:${inactiveId}`;

    await db
      .update(relationships)
      .set({ status: "ended", endedAt: new Date(), endedBy: inactiveParent })
      .where(eq(relationships.id, inactiveRel));
    expect(await assertPushStatus(inactiveId, "scheduled")).toBe(true);

    await processTargetOutboxUntil(inactiveRequestedKey, () =>
      assertPushStatus(inactiveId, "cancelled"),
    );

    const inactiveAudits = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.idempotencyKey, inactiveCancelAuditKey));
    expect(inactiveAudits).toHaveLength(1);
    expect((inactiveAudits[0]?.metadata as { reason?: string } | null)?.reason).toBe(
      "relationship_inactive",
    );
    expect(JSON.stringify(inactiveAudits[0]?.metadata ?? {})).not.toContain(`inactive-${secret}`);

    const inactiveCancelledOutbox = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.dedupeKey, inactiveCancelledKey));
    expect(inactiveCancelledOutbox).toHaveLength(1);
    expect(JSON.stringify(inactiveCancelledOutbox[0]?.payload ?? {})).not.toContain(
      `inactive-${secret}`,
    );

    await processTargetOutboxUntil(inactiveCancelledKey, async () => {
      const [row] = await db
        .select()
        .from(outboxEvents)
        .where(eq(outboxEvents.dedupeKey, inactiveCancelledKey))
        .limit(1);
      return row?.status === "processed";
    });

    const inactiveNotifBeforeReplay = (await db.select().from(notifications)).length;
    await replayDeadOnce(inactiveRequestedKey, inactiveParent, `inactive-${suffix}`);
    await processTargetOutboxUntil(inactiveRequestedKey, () =>
      assertPushStatus(inactiveId, "cancelled"),
    );
    expect(
      (
        await db
          .select()
          .from(auditEvents)
          .where(eq(auditEvents.idempotencyKey, inactiveCancelAuditKey))
      ).length,
    ).toBe(1);
    expect(
      (await db.select().from(outboxEvents).where(eq(outboxEvents.dedupeKey, inactiveCancelledKey)))
        .length,
    ).toBe(1);
    expect((await db.select().from(notifications)).length).toBe(inactiveNotifBeforeReplay);
    for (const notif of await db.select().from(notifications)) {
      expect(JSON.stringify(notif)).not.toContain(`inactive-${secret}`);
    }

    const notifBefore = (await db.select().from(notifications)).length;
    await replayDeadOnce(scheduledRequestedKey, creatorId, `pub-${suffix}`);
    await processTargetOutboxUntil(scheduledRequestedKey, () =>
      assertPushStatus(scheduledId, "published"),
    );
    expect(
      (
        await db
          .select()
          .from(auditEvents)
          .where(eq(auditEvents.idempotencyKey, `audit:family-push-worker-publish:${scheduledId}`))
      ).length,
    ).toBe(1);
    expect(
      (
        await db
          .select()
          .from(outboxEvents)
          .where(eq(outboxEvents.dedupeKey, `family_push.published:${scheduledId}`))
      ).length,
    ).toBe(1);
    expect((await db.select().from(notifications)).length).toBe(notifBefore);
    expect(JSON.stringify(await db.select().from(notifications))).not.toContain(secret);
  });

  it("P1-F03: family-access/identity interfaces via Family Content public services", async () => {
    const { creatorId, otherParentId, student, relationshipId, suffix } = await seedFamily();
    const parentIds = await listActiveParentIdsForStudent(db, student.studentId);
    expect(parentIds.sort()).toEqual([creatorId, otherParentId].sort());

    await expect(getParentOrStudentRole(db, creatorId)).resolves.toBe("parent");
    await expect(getParentOrStudentRole(db, student.studentId)).resolves.toBe("student");

    const published = await createFamilyPush(db, {
      actorId: creatorId,
      studentId: student.studentId,
      body: "visible",
      publishMode: "immediate",
      idempotencyKey: `f03-pub-${suffix}`,
    });

    await expect(
      getFamilyPush(db, {
        actorId: creatorId,
        actorRole: "parent",
        pushId: published.push.pushId,
      }),
    ).resolves.toMatchObject({ pushId: published.push.pushId, canEdit: true });

    await expect(
      getFamilyPush(db, {
        actorId: otherParentId,
        actorRole: "parent",
        pushId: published.push.pushId,
      }),
    ).resolves.toMatchObject({ canEdit: false });

    await expect(
      getFamilyPush(db, {
        actorId: student.studentId,
        actorRole: "student",
        pushId: published.push.pushId,
      }),
    ).resolves.toMatchObject({ status: "published" });

    await expect(loadUserRole(db, creatorId)).resolves.toBe("parent");
    await expect(loadUserRole(db, student.studentId)).resolves.toBe("student");

    const { adminId } = await bootstrapAdmin(db, `f03-admin-${suffix}@test.local`);
    await expect(loadUserRole(db, adminId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getParentOrStudentRole(db, adminId)).rejects.toMatchObject({ code: "FORBIDDEN" });

    const missingId = crypto.randomUUID();
    await expect(loadUserRole(db, missingId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      getFamilyPush(db, {
        actorId: missingId,
        actorRole: "parent",
        pushId: published.push.pushId,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await endRelationship(db, {
      actorId: creatorId,
      relationshipId,
      idempotencyKey: `f03-end-${suffix}`,
    });

    await expect(
      createFamilyPush(db, {
        actorId: creatorId,
        studentId: student.studentId,
        body: "after-end",
        publishMode: "draft",
        idempotencyKey: `f03-after-${suffix}`,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await expect(
      getFamilyPush(db, {
        actorId: creatorId,
        actorRole: "parent",
        pushId: published.push.pushId,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await expect(
      listFamilyPushes(db, {
        actorId: creatorId,
        actorRole: "parent",
        studentId: student.studentId,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    // Remaining linked parent still reads; inactive creator is excluded from active-parent list.
    await expect(
      getFamilyPush(db, {
        actorId: otherParentId,
        actorRole: "parent",
        pushId: published.push.pushId,
      }),
    ).resolves.toMatchObject({ status: "published" });
    expect(await listActiveParentIdsForStudent(db, student.studentId)).toEqual([otherParentId]);
  });
});
