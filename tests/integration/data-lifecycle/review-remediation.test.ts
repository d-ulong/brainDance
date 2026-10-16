import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  users,
  outboxEvents,
  pointBalanceProjection,
  pointLedgerEntries,
  scheduleItems,
  scheduleTaskExecutions,
  deletionRequests,
  deletionTombstones,
  contactVerificationCodes,
  trainingProfileProjection,
} from "@/db/schema";
import { createFormalPlan } from "@/modules/schedule/plan.service";
import { createGoals } from "@/modules/goals/goal.service";
import {
  createDeletionRequest,
  confirmDeletionRequest,
  processDeletionWorker,
  applyTombstonesBeforeProjectionRebuild,
} from "@/modules/data-lifecycle/deletion-request.service";
import {
  createExportJob,
  processExportJob,
  exportArtifactKey,
} from "@/modules/data-lifecycle/export-job.service";
import { configureM6OutboxArtifactStore } from "@/modules/data-lifecycle/m6-outbox-handlers";
import { createMemoryArtifactStore } from "@/modules/data-lifecycle/private-artifact-store";
import { seedRebuildSafeStudentBalance } from "../../helpers/redemption";
import { enqueueDueLifecycleWork } from "@/modules/data-lifecycle/due-work.service";
import { processOutboxEventById } from "@/modules/outbox/process-outbox-event.service";
import { appendDomainLedgerEntry, lockLedgerSubject } from "@/modules/settlement/ledger.service";
import { rebuildProjection } from "@/modules/projection/rebuild-projection.service";
import { createCatalogItem, listCatalogItems } from "@/modules/redemption/catalog.service";
import { createRedemptionRequest } from "@/modules/redemption/redemption.service";
import {
  getTrainingSessionForStudent,
  getTrainingSummaryForParent,
  getTrainingSummaryForSubject,
} from "@/modules/training/session.service";
import { resolveTrainingSubject } from "@/modules/training/training-subject";
import { bootstrapParentStudentRelationship } from "../../helpers/schedule";
import { completeReactionSession, ensureM5TrainingDefinitions } from "../../helpers/training";
import { closeTestDb, getTestDb, migrateTestDb, resetIdentityTables } from "../../helpers/db";

const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);
describe.skipIf(!hasDb)("independent review lifecycle, projection and privacy", () => {
  const db = getTestDb();
  beforeAll(migrateTestDb);
  beforeEach(async () => {
    await resetIdentityTables(db);
  });
  afterAll(closeTestDb);

  it("rebuild serializes against a writer before reading ledger and retains the new sum", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);
    let release!: () => void;
    let locked!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const acquired = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const writer = db.transaction(async (tx) => {
      await lockLedgerSubject(tx, studentId);
      locked();
      await hold;
      await appendDomainLedgerEntry(tx, {
        studentId,
        amount: 10,
        sourceType: "goal_reward",
        sourceId: crypto.randomUUID(),
        reason: "test",
        explanation: "test reward",
        createdBy: parentId,
        idempotencyKey: "writer",
      });
    });
    await acquired;
    let rebuilt = false;
    const rebuild = rebuildProjection(db, { studentId }).then((result) => {
      rebuilt = true;
      return result;
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(rebuilt).toBe(false);
    } finally {
      release();
    }
    await Promise.all([writer, rebuild]);
    const [row] = await db
      .select()
      .from(pointBalanceProjection)
      .where(eq(pointBalanceProjection.studentId, studentId));
    const totals = await db.execute(
      sql`SELECT sum(amount)::int AS balance FROM point_ledger_entries WHERE student_id = ${studentId}::uuid`,
    );
    expect(row?.balance).toBe(10);
    expect(row?.balance).toBe((totals[0] as { balance: number }).balance);
  });

  it("parent self confirmation debits once and its catalogue stays private from child", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);
    await db.transaction((tx) =>
      appendDomainLedgerEntry(tx, {
        studentId: parentId,
        amount: 30,
        sourceType: "goal_reward",
        sourceId: crypto.randomUUID(),
        reason: "test",
        explanation: "parent reward",
        createdBy: parentId,
        idempotencyKey: "parent-seed",
      }),
    );
    const catalogue = await createCatalogItem(db, {
      parentId,
      studentId: parentId,
      idempotencyKey: "own-reward",
      body: { title: "Coffee", cost: 10, monthlyLimit: 1 },
    });
    expect(
      (await listCatalogItems(db, studentId, { viewerRole: "student" })).map((row) => row.id),
    ).not.toContain(catalogue.item.id);
    const input = {
      studentId: parentId,
      actorId: parentId,
      catalogItemId: catalogue.item.id,
      idempotencyKey: "own-confirm",
    };
    const first = await createRedemptionRequest(db, input);
    const second = await createRedemptionRequest(db, input);
    expect(first.redemption.status).toBe("approved");
    expect(first.redemption.confirmedBy).toBe(parentId);
    expect(second.redemption.id).toBe(first.redemption.id);
    expect(second.idempotentReplay).toBe(true);
    const [balance] = await db
      .select()
      .from(pointBalanceProjection)
      .where(eq(pointBalanceProjection.studentId, parentId));
    expect(balance?.balance).toBe(20);
    const debits = await db
      .select()
      .from(pointLedgerEntries)
      .where(eq(pointLedgerEntries.sourceId, first.redemption.id));
    expect(debits).toHaveLength(1);
    await expect(
      createRedemptionRequest(db, {
        ...input,
        studentId,
        actorId: studentId,
        idempotencyKey: "child-steal",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("practice details and summaries remain self-only", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);
    await ensureM5TrainingDefinitions(db);
    const effective = await completeReactionSession(db, studentId, {
      startIdempotencyKey: "effective",
      submitIdempotencyKey: "effective-submit",
    });
    const practice = await completeReactionSession(db, studentId, {
      startIdempotencyKey: "practice",
      submitIdempotencyKey: "practice-submit",
    });
    expect(practice.submitted.sessionKind).toBe("practice");
    const parent = await getTrainingSummaryForParent(db, parentId, studentId);
    expect(parent.lastSession?.sessionId).toBe(effective.submitted.sessionId);
    const own = await getTrainingSummaryForSubject(db, await resolveTrainingSubject(db, studentId));
    expect(own.lastSession?.sessionId).toBe(practice.submitted.sessionId);
    await expect(
      getTrainingSessionForStudent(db, studentId, practice.submitted.sessionId, parentId),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(
      (await getTrainingSessionForStudent(db, studentId, practice.submitted.sessionId)).sessionKind,
    ).toBe("practice");
  });

  it("age archive is independently queued once and history remains readable", async () => {
    const { studentId } = await bootstrapParentStudentRelationship(db);
    await db.update(users).set({ birthDate: "2007-10-16" }).where(eq(users.id, studentId));
    const now = new Date("2026-10-16T00:00:00+08:00");
    expect(await enqueueDueLifecycleWork(db, now)).toBe(1);
    expect(await enqueueDueLifecycleWork(db, now)).toBe(0);
    const [event] = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.eventType, "lifecycle.age_due"));
    expect(event).toBeDefined();
    const delivered = await processOutboxEventById(db, {
      eventId: event!.id,
      workerId: "test-age",
    });
    expect(delivered.processed).toBe(true);
    const [subject] = await db.select().from(users).where(eq(users.id, studentId));
    expect(subject?.status).toBe("active");
    const [auditEvent] = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.eventType, "student.age_archived"));
    expect(auditEvent).toBeDefined();
  });
  it("widens int32 minimum reversal without changing the exact balance", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);
    const original = await db.transaction((tx) =>
      appendDomainLedgerEntry(tx, {
        studentId,
        amount: -2147483648,
        sourceType: "manual_penalty",
        sourceId: crypto.randomUUID(),
        reason: "test",
        explanation: "original",
        createdBy: parentId,
        idempotencyKey: "int-min",
      }),
    );
    await db.transaction((tx) =>
      appendDomainLedgerEntry(tx, {
        studentId,
        amount: 2147483648,
        sourceType: "manual_penalty_reversal",
        sourceId: crypto.randomUUID(),
        reversesEntryId: original.ledgerEntryId,
        reason: "reversal",
        explanation: "reversal",
        createdBy: parentId,
        idempotencyKey: "int-min-reverse",
      }),
    );
    await rebuildProjection(db, { studentId });
    const [balance] = await db
      .select()
      .from(pointBalanceProjection)
      .where(eq(pointBalanceProjection.studentId, studentId));
    expect(balance?.balance).toBe(0);
  });

  it("queues cutoff expiry without a user command and replay leaves one result", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);
    const earlier = new Date(Date.now() - 4 * 86400000);
    const familyDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(earlier);
    await createFormalPlan(db, {
      ownerId: parentId,
      studentId,
      idempotencyKey: "due-plan",
      now: earlier,
      body: { title: "Due task", localTime: "10:00", startDate: familyDate, endDate: null },
    });
    await enqueueDueLifecycleWork(db);
    const events = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.eventType, "lifecycle.schedule_due"));
    expect(events.length).toBeGreaterThan(0);
    const event = events[0]!;
    await processOutboxEventById(db, { eventId: event.id, workerId: "due-test" });
    const [item] = await db
      .select()
      .from(scheduleItems)
      .where(eq(scheduleItems.id, event.payload.scheduleItemId as string));
    expect(item?.status).toBe("expired");
    expect(
      (await processOutboxEventById(db, { eventId: event.id, workerId: "due-repeat" })).processed,
    ).toBe(false);
  });

  it("deletion scheduler respects 30days then executes and replays safely", async () => {
    const { studentId } = await bootstrapParentStudentRelationship(db);
    const store = createMemoryArtifactStore();
    configureM6OutboxArtifactStore(() => store);
    const created = await createDeletionRequest(db, {
      requestedBy: studentId,
      requesterRole: "student",
      targetType: "student_account",
      targetId: studentId,
      idempotencyKey: "delete-due",
      artifactStore: store,
    });
    await confirmDeletionRequest(db, {
      requestId: created.requestId,
      studentId,
      idempotencyKey: "confirm-due",
    });
    expect(
      (
        await processDeletionWorker(db, {
          requestId: created.requestId,
          artifactStore: store,
          now: new Date(created.revocableUntil.getTime() - 1),
        })
      ).executed,
    ).toBe(false);
    await enqueueDueLifecycleWork(db);
    expect(
      await db
        .select()
        .from(outboxEvents)
        .where(eq(outboxEvents.eventType, "lifecycle.deletion_due")),
    ).toHaveLength(0);
    await db
      .update(deletionRequests)
      .set({ revocableUntil: new Date(Date.now() - 1) })
      .where(eq(deletionRequests.id, created.requestId));
    await enqueueDueLifecycleWork(db);
    const [event] = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.eventType, "lifecycle.deletion_due"));
    expect(event).toBeDefined();
    await processOutboxEventById(db, { eventId: event!.id, workerId: "deletion-due" });
    const [subject] = await db.select().from(users).where(eq(users.id, studentId));
    expect(subject?.status).toBe("disabled");
    expect(subject?.birthDate).toBeNull();
    expect(
      (await processDeletionWorker(db, { requestId: created.requestId, artifactStore: store }))
        .executed,
    ).toBe(false);
  });

  it("exports goals and full execution, excludes parent practice and internal command keys", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);
    await seedRebuildSafeStudentBalance(db, { parentId, studentId, balance: 10 });
    const [item] = await db
      .select()
      .from(scheduleItems)
      .where(eq(scheduleItems.studentId, studentId));
    await db.insert(scheduleTaskExecutions).values({
      scheduleItemId: item!.id,
      taskType: "homework",
      revision: 1,
      checklist: [
        {
          id: "homework",
          title: "export-homework",
          completed: true,
          difficulty: "hard",
          durationMinutes: 17,
        },
      ],
      pomodoro: {},
    });
    await createGoals(db, {
      actorId: parentId,
      subjectIds: [studentId],
      content: "export-goal",
      notes: "export-notes",
      dueDate: "2027-01-01",
      horizon: "medium",
      idempotencyKey: "goal-export",
    });
    await ensureM5TrainingDefinitions(db);
    const first = await completeReactionSession(db, studentId, {
      startIdempotencyKey: "effective",
      submitIdempotencyKey: "effective-submit",
    });
    const practice = await completeReactionSession(db, studentId, {
      startIdempotencyKey: "practice",
      submitIdempotencyKey: "practice-submit",
    });
    const store = createMemoryArtifactStore();
    configureM6OutboxArtifactStore(() => store);
    const job = await createExportJob(db, {
      requesterId: parentId,
      requesterRole: "parent",
      studentId,
      idempotencyKey: "export-review",
    });
    await processExportJob(db, { jobId: job.jobId, artifactStore: store });
    const bytes = await store.read(exportArtifactKey(job.jobId));
    expect(bytes).not.toBeNull();
    const text = bytes!.toString("utf8");
    expect(text).toContain("export-goal");
    expect(text).toContain("export-notes");
    expect(text).toContain("export-homework");
    expect(text).toContain('"durationMinutes":17');
    expect(text).toContain(first.submitted.sessionId);
    expect(text).not.toContain(practice.submitted.sessionId);
    expect(text).not.toContain("createIdempotency");
    expect(text.toLowerCase()).not.toContain("idempotency");
    expect(text.toLowerCase()).not.toContain("payloadhash");
    expect(JSON.parse(text).sections.profile.username).toBeUndefined();
  });

  it("current summary cannot mix old definition or age-band projection rows", async () => {
    const { parentId, studentId } = await bootstrapParentStudentRelationship(db);
    await ensureM5TrainingDefinitions(db);
    const completed = await completeReactionSession(db, studentId, {
      startIdempotencyKey: "current",
      submitIdempotencyKey: "current-submit",
    });
    const subject = await resolveTrainingSubject(db, studentId);
    const baseline = await getTrainingSummaryForSubject(db, subject);
    expect(baseline.projection.length).toBeGreaterThan(0);
    const metricKey = baseline.projection[0]!.metricKey;
    await db.insert(trainingProfileProjection).values([
      {
        traineeId: studentId,
        studentId,
        trainingKey: "reaction",
        definitionVersion: 999,
        ageBand: subject.ageBand,
        metricKey,
        bestValue: "-999",
        lastValue: "-999",
        lastSourceSessionId: completed.submitted.sessionId,
        windowSummary: {},
        updatedAt: new Date(),
      },
      {
        traineeId: studentId,
        studentId,
        trainingKey: "reaction",
        definitionVersion: completed.started.definitionVersion,
        ageBand: "5-8",
        metricKey,
        bestValue: "-888",
        lastValue: "-888",
        lastSourceSessionId: completed.submitted.sessionId,
        windowSummary: {},
        updatedAt: new Date(),
      },
    ]);
    const summary = await getTrainingSummaryForParent(db, parentId, studentId);
    expect(summary.ageBand).toBe(subject.ageBand);
    expect(summary.projection.some((row) => row.bestValue < 0)).toBe(false);
  });

  it("tombstone replay clears partially restored identity credentials and preserves external purge intent", async () => {
    const { studentId } = await bootstrapParentStudentRelationship(db);
    const store = createMemoryArtifactStore();
    configureM6OutboxArtifactStore(() => store);
    const created = await createDeletionRequest(db, {
      requestedBy: studentId,
      requesterRole: "student",
      targetType: "student_account",
      targetId: studentId,
      idempotencyKey: "delete-partial",
      artifactStore: store,
    });
    await confirmDeletionRequest(db, {
      requestId: created.requestId,
      studentId,
      idempotencyKey: "confirm-partial",
    });
    await processDeletionWorker(db, {
      requestId: created.requestId,
      artifactStore: store,
      now: created.revocableUntil,
    });
    await db
      .update(users)
      .set({ email: "restored@example.test", phone: "13800000000", status: "active" })
      .where(eq(users.id, studentId));
    await db.insert(contactVerificationCodes).values({
      userId: studentId,
      contactType: "email",
      contactValue: "restored@example.test",
      codeHash: "hash",
      expiresAt: new Date(Date.now() + 3600000),
    });
    await db
      .update(deletionTombstones)
      .set({ payload: { artifactPurgePendingKeys: JSON.stringify(["export/pending-restored"]) } })
      .where(eq(deletionTombstones.deletionRequestId, created.requestId));
    await expect(processDeletionWorker(db, { requestId: created.requestId })).rejects.toMatchObject(
      { code: "ARTIFACT_UNAVAILABLE" },
    );
    const [pending] = await db
      .select()
      .from(deletionTombstones)
      .where(eq(deletionTombstones.deletionRequestId, created.requestId));
    expect(pending?.payload?.artifactPurgePendingKeys).toBeDefined();
    await applyTombstonesBeforeProjectionRebuild(db, { artifactStore: store });
    const [subject] = await db.select().from(users).where(eq(users.id, studentId));
    expect(subject?.email).toBeNull();
    expect(subject?.phone).toBeNull();
    expect(subject?.status).toBe("disabled");
    expect(
      await db
        .select()
        .from(contactVerificationCodes)
        .where(eq(contactVerificationCodes.userId, studentId)),
    ).toHaveLength(0);
  });
});
