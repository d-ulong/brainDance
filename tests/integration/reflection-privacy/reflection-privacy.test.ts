import { config } from "dotenv";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import * as schema from "@/db/schema";
import { auditEvents, outboxEvents, privateAccessGrants, users } from "@/db/schema";
import { requireDatabaseUrl } from "@/lib/env";
import { endRelationship } from "@/modules/family-access/end-relationship.service";
import { login, validateSession } from "@/modules/identity/login.service";
import { deleteDailyReflection } from "@/modules/reflection-privacy/delete-daily-reflection.service";
import { ReflectionPrivacyError } from "@/modules/reflection-privacy/errors";
import {
  getDailyReflection,
  listReflectionGrants,
} from "@/modules/reflection-privacy/get-daily-reflection.service";
import {
  grantPrivateAccess,
  revokePrivateAccess,
} from "@/modules/reflection-privacy/grant-private-access.service";
import { upsertDailyReflection } from "@/modules/reflection-privacy/upsert-daily-reflection.service";
import { toFamilyDate } from "@/modules/time-policy/to-family-date";
import {
  acceptParentForStudent,
  bootstrapVerifiedParentWithInvite,
  seedStudentUser,
} from "../../helpers/family-access";
import {
  closeTestDb,
  getTestDb,
  migrateTestDb,
  resetIdentityTables,
  type TestDb,
} from "../../helpers/db";

config({ path: ".env.local" });
config({ path: ".env" });

const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);
const today = toFamilyDate();

function createConcurrentBarrier(participants: number) {
  let arrived = 0;
  let release!: () => void;
  const proceed = new Promise<void>((resolve) => {
    release = resolve;
  });

  return {
    async wait(): Promise<void> {
      arrived += 1;
      if (arrived === participants) {
        release();
      }
      await proceed;
    },
  };
}

async function withIndependentConnection<T>(fn: (db: TestDb) => Promise<T>): Promise<T> {
  const client = postgres(requireDatabaseUrl(), { max: 1 });
  const independentDb = drizzle(client, { schema });
  try {
    return await fn(independentDb);
  } finally {
    await client.end({ timeout: 5 });
  }
}

function expectForbiddenWithoutBodyLeak(error: unknown, secretBody: string) {
  expect(error).toBeInstanceOf(ReflectionPrivacyError);
  expect((error as ReflectionPrivacyError).code).toBe("FORBIDDEN");
  expect(String(error)).not.toContain(secretBody);
}

describe.skipIf(!hasDb)("M4 reflection privacy", () => {
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

  it("AC-M4-4: normal reflection readable by all active parents", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const { parentId: parent1Id } = await bootstrapVerifiedParentWithInvite(
      db,
      `parent1_${suffix}@test.local`,
    );
    const { parentId: parent2Id } = await bootstrapVerifiedParentWithInvite(
      db,
      `parent2_${suffix}@test.local`,
    );
    const student = await seedStudentUser(db, {
      username: `student_${suffix}`,
      password: "StudentPass123!Student",
    });

    await acceptParentForStudent(db, { parentId: parent1Id, studentId: student.studentId });
    await acceptParentForStudent(db, { parentId: parent2Id, studentId: student.studentId });

    await upsertDailyReflection(db, {
      studentId: student.studentId,
      familyDate: today,
      body: "Normal reflection body",
      visibility: "normal",
      idempotencyKey: `upsert-normal-${suffix}`,
    });

    const forParent1 = await getDailyReflection(db, {
      actorId: parent1Id,
      actorRole: "parent",
      studentId: student.studentId,
      familyDate: today,
    });
    const forParent2 = await getDailyReflection(db, {
      actorId: parent2Id,
      actorRole: "parent",
      studentId: student.studentId,
      familyDate: today,
    });

    expect(forParent1.body).toBe("Normal reflection body");
    expect(forParent2.body).toBe("Normal reflection body");
  });

  it("AC-M4-4: private reflection only readable with explicit grant", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const { parentId: parent1Id } = await bootstrapVerifiedParentWithInvite(
      db,
      `parent1_${suffix}@test.local`,
    );
    const { parentId: parent2Id } = await bootstrapVerifiedParentWithInvite(
      db,
      `parent2_${suffix}@test.local`,
    );
    const student = await seedStudentUser(db, {
      username: `student_${suffix}`,
      password: "StudentPass123!Student",
    });

    await acceptParentForStudent(db, { parentId: parent1Id, studentId: student.studentId });
    await acceptParentForStudent(db, { parentId: parent2Id, studentId: student.studentId });

    await upsertDailyReflection(db, {
      studentId: student.studentId,
      familyDate: today,
      body: "Secret private body",
      visibility: "private",
      idempotencyKey: `upsert-private-${suffix}`,
    });

    await grantPrivateAccess(db, {
      studentId: student.studentId,
      familyDate: today,
      parentId: parent1Id,
      idempotencyKey: `grant-${suffix}`,
    });

    const granted = await getDailyReflection(db, {
      actorId: parent1Id,
      actorRole: "parent",
      studentId: student.studentId,
      familyDate: today,
    });
    expect(granted.body).toBe("Secret private body");

    await expect(
      getDailyReflection(db, {
        actorId: parent2Id,
        actorRole: "parent",
        studentId: student.studentId,
        familyDate: today,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("P2-01: normal reflection cannot become private", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const student = await seedStudentUser(db, {
      username: `student_${suffix}`,
      password: "StudentPass123!Student",
    });

    await upsertDailyReflection(db, {
      studentId: student.studentId,
      familyDate: today,
      body: "Started normal",
      visibility: "normal",
      idempotencyKey: `upsert-normal-only-${suffix}`,
    });

    await expect(
      upsertDailyReflection(db, {
        studentId: student.studentId,
        familyDate: today,
        body: "Try private",
        visibility: "private",
        idempotencyKey: `upsert-private-fail-${suffix}`,
      }),
    ).rejects.toMatchObject({ code: "STATE_CONFLICT" });
  });

  it("P2-02: revoke grant blocks parent read without body leak", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const email = `parent_${suffix}@test.local`;
    const { parentId } = await bootstrapVerifiedParentWithInvite(db, email);
    const student = await seedStudentUser(db, {
      username: `student_${suffix}`,
      password: "StudentPass123!Student",
    });
    await acceptParentForStudent(db, { parentId, studentId: student.studentId });

    await upsertDailyReflection(db, {
      studentId: student.studentId,
      familyDate: today,
      body: "Private secret text",
      visibility: "private",
      idempotencyKey: `upsert-${suffix}`,
    });

    await grantPrivateAccess(db, {
      studentId: student.studentId,
      familyDate: today,
      parentId,
      idempotencyKey: `grant-${suffix}`,
    });

    await revokePrivateAccess(db, {
      studentId: student.studentId,
      familyDate: today,
      parentId,
      idempotencyKey: `revoke-${suffix}`,
    });

    try {
      await getDailyReflection(db, {
        actorId: parentId,
        actorRole: "parent",
        studentId: student.studentId,
        familyDate: today,
      });
      throw new Error("Expected forbidden");
    } catch (error) {
      expect(error).toBeInstanceOf(ReflectionPrivacyError);
      expect((error as ReflectionPrivacyError).code).toBe("FORBIDDEN");
      expect(String(error)).not.toContain("Private secret text");
    }
  });

  it("P2-03: end relationship revokes private grants in same transaction", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const email = `parent_${suffix}@test.local`;
    const { parentId } = await bootstrapVerifiedParentWithInvite(db, email);
    const student = await seedStudentUser(db, {
      username: `student_${suffix}`,
      password: "StudentPass123!Student",
    });
    const link = await acceptParentForStudent(db, { parentId, studentId: student.studentId });

    await upsertDailyReflection(db, {
      studentId: student.studentId,
      familyDate: today,
      body: "End rel private",
      visibility: "private",
      idempotencyKey: `upsert-end-${suffix}`,
    });

    await grantPrivateAccess(db, {
      studentId: student.studentId,
      familyDate: today,
      parentId,
      idempotencyKey: `grant-end-${suffix}`,
    });

    await endRelationship(db, {
      actorId: parentId,
      relationshipId: link.relationshipId,
      idempotencyKey: `end-${suffix}`,
    });

    const activeGrants = await db
      .select()
      .from(privateAccessGrants)
      .where(
        and(eq(privateAccessGrants.parentId, parentId), isNull(privateAccessGrants.revokedAt)),
      );

    expect(activeGrants).toHaveLength(0);

    const auditRows = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "private_access.revoke"));
    expect(auditRows.length).toBeGreaterThan(0);
  });

  it("P2-04: grant and revoke are idempotent with audit/outbox", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const { parentId } = await bootstrapVerifiedParentWithInvite(db, `parent_${suffix}@test.local`);
    const student = await seedStudentUser(db, {
      username: `student_${suffix}`,
      password: "StudentPass123!Student",
    });
    await acceptParentForStudent(db, { parentId, studentId: student.studentId });

    await upsertDailyReflection(db, {
      studentId: student.studentId,
      familyDate: today,
      body: "Idempotent private",
      visibility: "private",
      idempotencyKey: `upsert-idem-${suffix}`,
    });

    const firstGrant = await grantPrivateAccess(db, {
      studentId: student.studentId,
      familyDate: today,
      parentId,
      idempotencyKey: `grant-idem-${suffix}`,
    });
    const replayGrant = await grantPrivateAccess(db, {
      studentId: student.studentId,
      familyDate: today,
      parentId,
      idempotencyKey: `grant-idem-${suffix}`,
    });
    expect(replayGrant.idempotentReplay).toBe(true);
    expect(replayGrant.grantId).toBe(firstGrant.grantId);

    const firstRevoke = await revokePrivateAccess(db, {
      studentId: student.studentId,
      familyDate: today,
      parentId,
      idempotencyKey: `revoke-idem-${suffix}`,
    });
    const replayRevoke = await revokePrivateAccess(db, {
      studentId: student.studentId,
      familyDate: today,
      parentId,
      idempotencyKey: `revoke-idem-${suffix}`,
    });
    expect(replayRevoke.idempotentReplay).toBe(true);
    expect(replayRevoke.grantId).toBe(firstRevoke.grantId);

    const outboxGrant = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.dedupeKey, `outbox:private_access.grant:grant-idem-${suffix}`));
    expect(outboxGrant).toHaveLength(1);
  });

  it("P2-05: revoke increments parent epoch invalidating stale session", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const email = `parent_${suffix}@test.local`;
    const { parentId } = await bootstrapVerifiedParentWithInvite(db, email);
    const student = await seedStudentUser(db, {
      username: `student_${suffix}`,
      password: "StudentPass123!Student",
    });
    await acceptParentForStudent(db, { parentId, studentId: student.studentId });

    await upsertDailyReflection(db, {
      studentId: student.studentId,
      familyDate: today,
      body: "Epoch private",
      visibility: "private",
      idempotencyKey: `upsert-epoch-${suffix}`,
    });

    await grantPrivateAccess(db, {
      studentId: student.studentId,
      familyDate: today,
      parentId,
      idempotencyKey: `grant-epoch-${suffix}`,
    });

    const parentSession = await login(db, {
      identifier: email,
      password: "ParentPass123!Parent",
      idempotencyKey: `login-epoch-${suffix}`,
    });

    await revokePrivateAccess(db, {
      studentId: student.studentId,
      familyDate: today,
      parentId,
      idempotencyKey: `revoke-epoch-${suffix}`,
    });

    const stale = await validateSession(db, parentSession.sessionId);
    expect(stale).toBeNull();

    const freshSession = await login(db, {
      identifier: email,
      password: "ParentPass123!Parent",
      idempotencyKey: `login-epoch-fresh-${suffix}`,
    });
    expect(freshSession).not.toBeNull();

    await expect(
      getDailyReflection(db, {
        actorId: parentId,
        actorRole: "parent",
        studentId: student.studentId,
        familyDate: today,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("P2-06: two students private reflections isolated between parents", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const { parentId } = await bootstrapVerifiedParentWithInvite(db, `parent_${suffix}@test.local`);
    const student1 = await seedStudentUser(db, {
      username: `student1_${suffix}`,
      password: "StudentPass123!Student",
    });
    const student2 = await seedStudentUser(db, {
      username: `student2_${suffix}`,
      password: "StudentPass123!Student",
    });

    await acceptParentForStudent(db, {
      parentId,
      studentId: student1.studentId,
      idempotencySuffix: "s1",
    });
    await acceptParentForStudent(db, {
      parentId,
      studentId: student2.studentId,
      idempotencySuffix: "s2",
    });

    await upsertDailyReflection(db, {
      studentId: student1.studentId,
      familyDate: today,
      body: "Student1 private",
      visibility: "private",
      idempotencyKey: `upsert-s1-${suffix}`,
    });
    await upsertDailyReflection(db, {
      studentId: student2.studentId,
      familyDate: today,
      body: "Student2 private",
      visibility: "private",
      idempotencyKey: `upsert-s2-${suffix}`,
    });

    await grantPrivateAccess(db, {
      studentId: student1.studentId,
      familyDate: today,
      parentId,
      idempotencyKey: `grant-s1-${suffix}`,
    });

    const s1 = await getDailyReflection(db, {
      actorId: parentId,
      actorRole: "parent",
      studentId: student1.studentId,
      familyDate: today,
    });
    expect(s1.body).toBe("Student1 private");

    await expect(
      getDailyReflection(db, {
        actorId: parentId,
        actorRole: "parent",
        studentId: student2.studentId,
        familyDate: today,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("P2-07: concurrent grant converges to one active grant", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const { parentId } = await bootstrapVerifiedParentWithInvite(db, `parent_${suffix}@test.local`);
    const student = await seedStudentUser(db, {
      username: `student_${suffix}`,
      password: "StudentPass123!Student",
    });
    await acceptParentForStudent(db, { parentId, studentId: student.studentId });

    await upsertDailyReflection(db, {
      studentId: student.studentId,
      familyDate: today,
      body: "Concurrent private",
      visibility: "private",
      idempotencyKey: `upsert-conc-${suffix}`,
    });

    const barrier = createConcurrentBarrier(2);
    const key = `grant-conc-${suffix}`;

    const [result1, result2] = await Promise.allSettled([
      withIndependentConnection(async (conn) => {
        await barrier.wait();
        return grantPrivateAccess(conn, {
          studentId: student.studentId,
          familyDate: today,
          parentId,
          idempotencyKey: `${key}-a`,
        });
      }),
      withIndependentConnection(async (conn) => {
        await barrier.wait();
        return grantPrivateAccess(conn, {
          studentId: student.studentId,
          familyDate: today,
          parentId,
          idempotencyKey: `${key}-b`,
        });
      }),
    ]);

    const fulfilled = [result1, result2].filter((result) => result.status === "fulfilled");
    expect(fulfilled.length).toBeGreaterThan(0);

    const activeGrants = await db
      .select()
      .from(privateAccessGrants)
      .where(
        and(eq(privateAccessGrants.parentId, parentId), isNull(privateAccessGrants.revokedAt)),
      );
    expect(activeGrants).toHaveLength(1);
  });

  it("P2-08: delete clears body and revokes grants", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const { parentId } = await bootstrapVerifiedParentWithInvite(db, `parent_${suffix}@test.local`);
    const student = await seedStudentUser(db, {
      username: `student_${suffix}`,
      password: "StudentPass123!Student",
    });
    await acceptParentForStudent(db, { parentId, studentId: student.studentId });

    await upsertDailyReflection(db, {
      studentId: student.studentId,
      familyDate: today,
      body: "Delete me",
      visibility: "private",
      idempotencyKey: `upsert-del-${suffix}`,
    });

    await grantPrivateAccess(db, {
      studentId: student.studentId,
      familyDate: today,
      parentId,
      idempotencyKey: `grant-del-${suffix}`,
    });

    await deleteDailyReflection(db, {
      studentId: student.studentId,
      familyDate: today,
      idempotencyKey: `delete-${suffix}`,
    });

    await expect(
      getDailyReflection(db, {
        actorId: student.studentId,
        actorRole: "student",
        studentId: student.studentId,
        familyDate: today,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const grants = await listReflectionGrants(db, {
      studentId: student.studentId,
      familyDate: today,
    }).catch(() => ({ grants: [] }));
    expect(grants.grants).toHaveLength(0);
  });

  it("P2-09: new parent does not auto-read historical private reflection", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const { parentId: parent1Id } = await bootstrapVerifiedParentWithInvite(
      db,
      `parent1_${suffix}@test.local`,
    );
    const { parentId: parent2Id } = await bootstrapVerifiedParentWithInvite(
      db,
      `parent2_${suffix}@test.local`,
    );
    const student = await seedStudentUser(db, {
      username: `student_${suffix}`,
      password: "StudentPass123!Student",
    });

    await acceptParentForStudent(db, { parentId: parent1Id, studentId: student.studentId });

    await upsertDailyReflection(db, {
      studentId: student.studentId,
      familyDate: today,
      body: "Historical private",
      visibility: "private",
      idempotencyKey: `upsert-hist-${suffix}`,
    });

    await grantPrivateAccess(db, {
      studentId: student.studentId,
      familyDate: today,
      parentId: parent1Id,
      idempotencyKey: `grant-hist-${suffix}`,
    });

    await acceptParentForStudent(db, {
      parentId: parent2Id,
      studentId: student.studentId,
      idempotencySuffix: "p2",
    });

    await expect(
      getDailyReflection(db, {
        actorId: parent2Id,
        actorRole: "parent",
        studentId: student.studentId,
        familyDate: today,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const [parent2Epoch] = await db
      .select({ authorizationEpoch: users.authorizationEpoch })
      .from(users)
      .where(eq(users.id, parent2Id));
    expect(parent2Epoch?.authorizationEpoch).toBeGreaterThan(0);
  });

  it("P2-F01: grant/end interleaving leaves no active grant; re-link does not restore read", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const email = `parent_${suffix}@test.local`;
    const secretBody = `Interleave secret ${suffix}`;
    const { parentId } = await bootstrapVerifiedParentWithInvite(db, email);
    const student = await seedStudentUser(db, {
      username: `student_${suffix}`,
      password: "StudentPass123!Student",
    });
    const link = await acceptParentForStudent(db, { parentId, studentId: student.studentId });

    await upsertDailyReflection(db, {
      studentId: student.studentId,
      familyDate: today,
      body: secretBody,
      visibility: "private",
      idempotencyKey: `upsert-f01-${suffix}`,
    });

    await endRelationship(db, {
      actorId: parentId,
      relationshipId: link.relationshipId,
      idempotencyKey: `end-f01-seq-${suffix}`,
    });

    await expect(
      grantPrivateAccess(db, {
        studentId: student.studentId,
        familyDate: today,
        parentId,
        idempotencyKey: `grant-f01-seq-${suffix}`,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const relink = await acceptParentForStudent(db, {
      parentId,
      studentId: student.studentId,
      idempotencySuffix: `relink-${suffix}`,
    });

    const barrier = createConcurrentBarrier(2);
    await Promise.allSettled([
      withIndependentConnection(async (conn) => {
        await barrier.wait();
        return grantPrivateAccess(conn, {
          studentId: student.studentId,
          familyDate: today,
          parentId,
          idempotencyKey: `grant-f01-conc-${suffix}`,
        });
      }),
      withIndependentConnection(async (conn) => {
        await barrier.wait();
        return endRelationship(conn, {
          actorId: parentId,
          relationshipId: relink.relationshipId,
          idempotencyKey: `end-f01-conc-${suffix}`,
        });
      }),
    ]);

    const activeGrants = await db
      .select()
      .from(privateAccessGrants)
      .where(
        and(eq(privateAccessGrants.parentId, parentId), isNull(privateAccessGrants.revokedAt)),
      );
    expect(activeGrants).toHaveLength(0);

    await acceptParentForStudent(db, {
      parentId,
      studentId: student.studentId,
      idempotencySuffix: `relink2-${suffix}`,
    });

    try {
      await getDailyReflection(db, {
        actorId: parentId,
        actorRole: "parent",
        studentId: student.studentId,
        familyDate: today,
      });
      throw new Error("Expected forbidden after re-link");
    } catch (error) {
      expectForbiddenWithoutBodyLeak(error, secretBody);
    }
  });

  it("P2-F02: concurrent read/revoke completes with no body leak after revoke", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const email = `parent_${suffix}@test.local`;
    const secretBody = `Concurrent revoke secret ${suffix}`;
    const { parentId } = await bootstrapVerifiedParentWithInvite(db, email);
    const student = await seedStudentUser(db, {
      username: `student_${suffix}`,
      password: "StudentPass123!Student",
    });
    await acceptParentForStudent(db, { parentId, studentId: student.studentId });

    await upsertDailyReflection(db, {
      studentId: student.studentId,
      familyDate: today,
      body: secretBody,
      visibility: "private",
      idempotencyKey: `upsert-f02-${suffix}`,
    });

    await grantPrivateAccess(db, {
      studentId: student.studentId,
      familyDate: today,
      parentId,
      idempotencyKey: `grant-f02-${suffix}`,
    });

    const barrier = createConcurrentBarrier(2);
    const [readResult, revokeResult] = await Promise.allSettled([
      withIndependentConnection(async (conn) => {
        await barrier.wait();
        return getDailyReflection(conn, {
          actorId: parentId,
          actorRole: "parent",
          studentId: student.studentId,
          familyDate: today,
        });
      }),
      withIndependentConnection(async (conn) => {
        await barrier.wait();
        return revokePrivateAccess(conn, {
          studentId: student.studentId,
          familyDate: today,
          parentId,
          idempotencyKey: `revoke-f02-${suffix}`,
        });
      }),
    ]);

    expect(revokeResult.status).toBe("fulfilled");
    if (readResult.status === "rejected") {
      expectForbiddenWithoutBodyLeak(readResult.reason, secretBody);
    } else if (readResult.status === "fulfilled") {
      expect(readResult.value.body).toBe(secretBody);
    }

    try {
      await getDailyReflection(db, {
        actorId: parentId,
        actorRole: "parent",
        studentId: student.studentId,
        familyDate: today,
      });
      throw new Error("Expected forbidden after concurrent revoke");
    } catch (error) {
      expectForbiddenWithoutBodyLeak(error, secretBody);
    }
  });
});
