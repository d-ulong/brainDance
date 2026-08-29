import { config } from "dotenv";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  auditEvents,
  familyMemberships,
  outboxEvents,
  plans,
  pointRules,
  relationships,
} from "@/db/schema";
import { endRelationship } from "@/modules/family-access/end-relationship.service";
import { issueAssociationCode } from "@/modules/family-access/association-code.service";
import {
  acceptRelationshipRequest,
  createRelationshipRequest,
  getStudentProfileForParent,
} from "@/modules/family-access/relationship-request.service";
import { createFormalPlan } from "@/modules/schedule/plan.service";
import { enablePointRule } from "@/modules/settlement/point-rule.service";
import { getTrainingSummaryForParent } from "@/modules/training/session.service";
import {
  acceptParentForStudent,
  bootstrapVerifiedParentWithInvite,
  seedStudentUser,
} from "../../helpers/family-access";
import { DEFAULT_PLAN_BODY, FIXED_NOW, resetScheduleTables } from "../../helpers/schedule";
import { completeReactionSession, ensureReactionDefinitions } from "../../helpers/training";
import { closeTestDb, getTestDb, migrateTestDb, resetIdentityTables } from "../../helpers/db";

config({ path: ".env.local" });
config({ path: ".env" });

const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("M4 multi-parent authorization", () => {
  const db = getTestDb();

  beforeAll(async () => {
    process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";
    await migrateTestDb();
  });

  beforeEach(async () => {
    await resetIdentityTables(db);
    await resetScheduleTables(db);
    await ensureReactionDefinitions(db);
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("AC-M4-1: second parent joins existing family and both parents retain scoped access", async () => {
    const { parentId: parent1Id } = await bootstrapVerifiedParentWithInvite(
      db,
      `parent1-${crypto.randomUUID()}@test.local`,
    );
    const { parentId: parent2Id } = await bootstrapVerifiedParentWithInvite(
      db,
      `parent2-${crypto.randomUUID()}@test.local`,
    );
    const student = await seedStudentUser(db, {
      username: `student_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });

    const first = await acceptParentForStudent(db, {
      parentId: parent1Id,
      studentId: student.studentId,
      idempotencySuffix: "p1",
    });
    const second = await acceptParentForStudent(db, {
      parentId: parent2Id,
      studentId: student.studentId,
      idempotencySuffix: "p2",
    });

    expect(second.familyId).toBe(first.familyId);

    const activeRelationships = await db
      .select()
      .from(relationships)
      .where(
        and(eq(relationships.studentId, student.studentId), eq(relationships.status, "active")),
      );
    expect(activeRelationships).toHaveLength(2);
    expect(new Set(activeRelationships.map((row) => row.familyId)).size).toBe(1);

    await completeReactionSession(db, student.studentId);

    await getStudentProfileForParent(db, parent1Id, student.studentId);
    await getStudentProfileForParent(db, parent2Id, student.studentId);
    await getTrainingSummaryForParent(db, parent1Id, student.studentId);
    await getTrainingSummaryForParent(db, parent2Id, student.studentId);
  });

  it("AC-M4-2: ending one student relationship preserves access to another student in the same family", async () => {
    const { parentId } = await bootstrapVerifiedParentWithInvite(
      db,
      `parent-${crypto.randomUUID()}@test.local`,
    );
    const student1 = await seedStudentUser(db, {
      username: `student1_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });
    const student2 = await seedStudentUser(db, {
      username: `student2_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });

    const rel1 = await acceptParentForStudent(db, {
      parentId,
      studentId: student1.studentId,
      idempotencySuffix: "s1",
    });
    const rel2 = await acceptParentForStudent(db, {
      parentId,
      studentId: student2.studentId,
      idempotencySuffix: "s2",
    });

    expect(rel1.familyId).toBe(rel2.familyId);

    await endRelationship(db, {
      actorId: parentId,
      relationshipId: rel1.relationshipId,
      idempotencyKey: "end-student1-only",
    });

    await expect(
      getStudentProfileForParent(db, parentId, student1.studentId),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await getStudentProfileForParent(db, parentId, student2.studentId);

    const [parentMembership] = await db
      .select()
      .from(familyMemberships)
      .where(
        and(
          eq(familyMemberships.familyId, rel1.familyId),
          eq(familyMemberships.userId, parentId),
          isNull(familyMemberships.leftAt),
        ),
      );
    expect(parentMembership).toBeTruthy();
  });

  it("AC-M4-2: ending one parent relationship preserves other parent access to the same student", async () => {
    const { parentId: parent1Id } = await bootstrapVerifiedParentWithInvite(
      db,
      `parent1-${crypto.randomUUID()}@test.local`,
    );
    const { parentId: parent2Id } = await bootstrapVerifiedParentWithInvite(
      db,
      `parent2-${crypto.randomUUID()}@test.local`,
    );
    const student = await seedStudentUser(db, {
      username: `student_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });

    const rel1 = await acceptParentForStudent(db, {
      parentId: parent1Id,
      studentId: student.studentId,
      idempotencySuffix: "p1",
    });
    await acceptParentForStudent(db, {
      parentId: parent2Id,
      studentId: student.studentId,
      idempotencySuffix: "p2",
    });

    await endRelationship(db, {
      actorId: parent1Id,
      relationshipId: rel1.relationshipId,
      idempotencyKey: "end-parent1-only",
    });

    await expect(
      getStudentProfileForParent(db, parent1Id, student.studentId),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await getStudentProfileForParent(db, parent2Id, student.studentId);

    const [studentMembership] = await db
      .select()
      .from(familyMemberships)
      .where(
        and(
          eq(familyMemberships.familyId, rel1.familyId),
          eq(familyMemberships.userId, student.studentId),
          isNull(familyMemberships.leftAt),
        ),
      );
    expect(studentMembership).toBeTruthy();
  });

  it("AC-M4-3: last parent leaving ends student membership and re-association does not restore deactivated configs", async () => {
    const { parentId } = await bootstrapVerifiedParentWithInvite(
      db,
      `parent-${crypto.randomUUID()}@test.local`,
    );
    const student = await seedStudentUser(db, {
      username: `student_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });

    const accepted = await acceptParentForStudent(db, {
      parentId,
      studentId: student.studentId,
      idempotencySuffix: "initial",
    });

    const createdPlan = await createFormalPlan(db, {
      ownerId: parentId,
      studentId: student.studentId,
      idempotencyKey: "plan-before-end",
      body: DEFAULT_PLAN_BODY,
      now: FIXED_NOW,
    });

    await enablePointRule(db, {
      parentId,
      studentId: student.studentId,
      idempotencyKey: "rule-before-end",
      body: { templateId: "schedule_system_complete_v1" },
      now: FIXED_NOW,
    });

    await endRelationship(db, {
      actorId: parentId,
      relationshipId: accepted.relationshipId,
      idempotencyKey: "end-last-parent",
    });

    const activeRelationships = await db
      .select()
      .from(relationships)
      .where(
        and(eq(relationships.studentId, student.studentId), eq(relationships.status, "active")),
      );
    expect(activeRelationships).toHaveLength(0);

    const [studentMembership] = await db
      .select()
      .from(familyMemberships)
      .where(
        and(
          eq(familyMemberships.familyId, accepted.familyId),
          eq(familyMemberships.userId, student.studentId),
        ),
      );
    expect(studentMembership?.leftAt).toBeTruthy();

    const [plan] = await db.select().from(plans).where(eq(plans.id, createdPlan.planId));
    expect(plan?.status).toBe("inactive");

    const [rule] = await db
      .select()
      .from(pointRules)
      .where(
        and(eq(pointRules.studentId, student.studentId), eq(pointRules.creatorParentId, parentId)),
      );
    expect(rule?.active).toBe(false);

    await acceptParentForStudent(db, {
      parentId,
      studentId: student.studentId,
      idempotencySuffix: "reassociate",
    });

    const [planAfterReassociate] = await db
      .select()
      .from(plans)
      .where(eq(plans.id, createdPlan.planId));
    expect(planAfterReassociate?.status).toBe("inactive");

    const [ruleAfterReassociate] = await db
      .select()
      .from(pointRules)
      .where(
        and(eq(pointRules.studentId, student.studentId), eq(pointRules.creatorParentId, parentId)),
      );
    expect(ruleAfterReassociate?.active).toBe(false);
  });

  it("AC-M4-5: relationship end is idempotent and writes audit/outbox once", async () => {
    const { parentId } = await bootstrapVerifiedParentWithInvite(
      db,
      `parent-${crypto.randomUUID()}@test.local`,
    );
    const student = await seedStudentUser(db, {
      username: `student_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });

    const accepted = await acceptParentForStudent(db, {
      parentId,
      studentId: student.studentId,
      idempotencySuffix: "idem",
    });

    const first = await endRelationship(db, {
      actorId: parentId,
      relationshipId: accepted.relationshipId,
      idempotencyKey: "end-idem",
    });

    const replay = await endRelationship(db, {
      actorId: parentId,
      relationshipId: accepted.relationshipId,
      idempotencyKey: "end-idem",
    });

    expect(first.idempotentReplay).toBe(false);
    expect(replay.idempotentReplay).toBe(true);

    const auditRows = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.idempotencyKey, "audit:rel-end:end-idem"));
    expect(auditRows).toHaveLength(1);

    const outboxRows = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.dedupeKey, "outbox:rel-end:end-idem"));
    expect(outboxRows).toHaveLength(1);
  });

  it("AC-M4-5: concurrent second-parent acceptance joins one family without duplicate memberships", async () => {
    const { parentId: parent1Id } = await bootstrapVerifiedParentWithInvite(
      db,
      `parent1-${crypto.randomUUID()}@test.local`,
    );
    const { parentId: parent2Id } = await bootstrapVerifiedParentWithInvite(
      db,
      `parent2-${crypto.randomUUID()}@test.local`,
    );
    const student = await seedStudentUser(db, {
      username: `student_${crypto.randomUUID().slice(0, 8)}`,
      password: "StudentPass123!Student",
    });

    await acceptParentForStudent(db, {
      parentId: parent1Id,
      studentId: student.studentId,
      idempotencySuffix: "first-parent",
    });

    const code = await issueAssociationCode(db, {
      studentId: student.studentId,
      idempotencyKey: `issue-concurrent-${crypto.randomUUID()}`,
    });
    const pending = await createRelationshipRequest(db, {
      parentId: parent2Id,
      associationCodePlaintext: code.codePlaintext,
      idempotencyKey: `req-concurrent-${crypto.randomUUID()}`,
    });

    const results = await Promise.allSettled([
      acceptRelationshipRequest(db, {
        studentId: student.studentId,
        requestId: pending.requestId,
        idempotencyKey: "accept-concurrent-second-parent",
      }),
      acceptRelationshipRequest(db, {
        studentId: student.studentId,
        requestId: pending.requestId,
        idempotencyKey: "accept-concurrent-second-parent",
      }),
    ]);

    expect(results.every((result) => result.status === "fulfilled")).toBe(true);

    const activeRelationships = await db
      .select()
      .from(relationships)
      .where(
        and(eq(relationships.studentId, student.studentId), eq(relationships.status, "active")),
      );
    expect(activeRelationships).toHaveLength(2);
    expect(new Set(activeRelationships.map((row) => row.familyId)).size).toBe(1);

    const activeMemberships = await db
      .select()
      .from(familyMemberships)
      .where(
        and(eq(familyMemberships.userId, student.studentId), isNull(familyMemberships.leftAt)),
      );
    expect(activeMemberships).toHaveLength(1);
  });
});
