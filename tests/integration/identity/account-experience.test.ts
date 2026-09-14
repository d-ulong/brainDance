import { config } from "dotenv";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  users,
  relationships,
  familyMemberships,
  guardianConsents,
  outboxEvents,
  loginSecurityEvents,
  invitations,
} from "@/db/schema";
import { registerParent, registerStudent } from "@/modules/identity/registration.service";
import { createInvitation } from "@/modules/identity/invitation.service";
import { createControlledStudent } from "@/modules/identity/create-controlled-student.service";
import { login } from "@/modules/identity/login.service";
import { loginPolicy } from "@/modules/identity/login-policy";
import { bootstrapAdmin } from "../../helpers/identity";
import { bootstrapVerifiedParentWithInvite } from "../../helpers/family-access";
import { closeTestDb, getTestDb, migrateTestDb, resetIdentityTables } from "../../helpers/db";

config({ path: ".env.local" });
const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);
describe.skipIf(!hasDb)("account experience contracts", () => {
  const db = getTestDb();
  beforeAll(async () => {
    process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";
    await migrateTestDb();
  });
  beforeEach(async () => {
    await resetIdentityTables(db);
  });
  afterAll(closeTestDb);

  it("registers a named teen with a student invitation, usable login, no implied family, and safe replay", async () => {
    const { adminId } = await bootstrapAdmin(db);
    const invite = await createInvitation(db, {
      adminId,
      targetRole: "student",
      idempotencyKey: "teen-invite",
    });
    const input = {
      invitationCode: invite.codePlaintext,
      username: "teen_new",
      displayName: "  小星  ",
      birthDate: "2011-05-01",
      password: "Abc123",
      idempotencyKey: "teen-register",
    };
    const results = await Promise.all([registerStudent(db, input), registerStudent(db, input)]);
    expect(results[0].userId).toBe(results[1].userId);
    expect(results.filter((r) => r.idempotentReplay)).toHaveLength(1);
    expect(
      (await db.select().from(invitations).where(eq(invitations.id, invite.invitationId)))[0]
        .usedCount,
    ).toBe(1);
    expect((await db.select().from(users).where(eq(users.id, results[0].userId)))[0]).toMatchObject(
      { displayName: "小星", role: "student", birthDate: input.birthDate, status: "active" },
    );
    expect(await db.select().from(relationships)).toHaveLength(0);
    expect(
      (await login(db, { identifier: input.username, password: input.password })).contactVerified,
    ).toBe(true);
    await expect(registerStudent(db, { ...input, username: "different" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("rejects missing names, invalid/out-of-band birthdays, and wrong invitation roles without consuming", async () => {
    const { adminId } = await bootstrapAdmin(db);
    const invite = await createInvitation(db, {
      adminId,
      targetRole: "parent",
      idempotencyKey: "parent-invite",
    });
    const input = {
      invitationCode: invite.codePlaintext,
      username: "teen_new",
      displayName: "小星",
      birthDate: "2011-05-01",
      password: "Abc123",
      idempotencyKey: "teen-invalid",
    };
    await expect(registerStudent(db, input)).rejects.toMatchObject({
      code: "INVITATION_ROLE_MISMATCH",
    });
    for (const birthDate of ["2017-01-01", "2000-01-01", "2011-02-30"])
      await expect(registerStudent(db, { ...input, birthDate })).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
      });
    await expect(registerStudent(db, { ...input, displayName: "   " })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    await expect(
      registerParent(db, { ...input, displayName: "   ", email: "new@test.local" }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(
      (await db.select().from(invitations).where(eq(invitations.id, invite.invitationId)))[0]
        .usedCount,
    ).toBe(0);
  });

  it("creates and binds atomically, serializes replay, and joins siblings to the same family", async () => {
    const { parentId } = await bootstrapVerifiedParentWithInvite(db, "family@test.local");
    const input = {
      parentId,
      username: "child_new",
      displayName: "小芽",
      birthDate: "2017-01-01",
      initialPassword: "Abc123",
      idempotencyKey: "child-create",
    };
    const [created, replay] = await Promise.all([
      createControlledStudent(db, input),
      createControlledStudent(db, input),
    ]);
    expect(created.studentId).toBe(replay.studentId);
    await createControlledStudent(db, {
      ...input,
      username: "child_two",
      idempotencyKey: "child-two",
    });
    const rels = await db.select().from(relationships).where(eq(relationships.parentId, parentId));
    expect(rels).toHaveLength(2);
    expect(new Set(rels.map((rel) => rel.familyId)).size).toBe(1);
    expect(rels.every((rel) => rel.status === "active")).toBe(true);
    expect(await db.select().from(familyMemberships)).toHaveLength(3);
    expect(await db.select().from(guardianConsents)).toHaveLength(2);
    const consent = (
      await db
        .select()
        .from(guardianConsents)
        .where(eq(guardianConsents.studentId, created.studentId))
    )[0];
    expect(consent.evidence?.source).toBe("parent_created_student");
    expect(
      await db
        .select()
        .from(outboxEvents)
        .where(eq(outboxEvents.eventType, "relationship.accepted")),
    ).toHaveLength(2);
  });

  it("does not immediately relock on stale failures after an expired lock", async () => {
    const { parentId } = await bootstrapVerifiedParentWithInvite(db, "lock-new@test.local");
    await db
      .update(users)
      .set({ status: "locked", lockedUntil: new Date(Date.now() - 1) })
      .where(eq(users.id, parentId));
    await db.insert(loginSecurityEvents).values(
      Array.from({ length: 5 }, () => ({
        accountKey: "lock-new@test.local",
        eventType: "login_failed",
        occurredAt: new Date(Date.now() - 500),
      })),
    );
    await expect(
      login(db, { identifier: "lock-new@test.local", password: "wrong" }),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    const [parent] = await db.select().from(users).where(eq(users.id, parentId));
    expect(parent.lockedUntil).toBeNull();
    expect(
      await db
        .select()
        .from(loginSecurityEvents)
        .where(
          and(
            eq(loginSecurityEvents.accountKey, "lock-new@test.local"),
            eq(loginSecurityEvents.eventType, "account_unlocked"),
          ),
        ),
    ).toHaveLength(1);
    expect(
      (await login(db, { identifier: "lock-new@test.local", password: "Parent1aXy" })).userId,
    ).toBe(parentId);
  });

  it("limits relaxed lockouts to an explicit non-production loopback pilot", () => {
    expect(
      loginPolicy({
        NODE_ENV: "development",
        LOCAL_PILOT_MODE: "true",
        NEXT_PUBLIC_APP_URL: "http://localhost:3002",
      }),
    ).toEqual({ maxFailures: 10, lockDurationMs: 60_000 });
    for (const env of [
      { NODE_ENV: "production" as const },
      { NEXT_PUBLIC_APP_URL: "https://example.com" },
      { LOCAL_PILOT_MODE: "false" },
    ]) {
      expect(
        loginPolicy({
          NODE_ENV: "development",
          LOCAL_PILOT_MODE: "true",
          NEXT_PUBLIC_APP_URL: "http://localhost:3002",
          ...env,
        }),
      ).toEqual({ maxFailures: 5, lockDurationMs: 900_000 });
    }
    vi.unstubAllEnvs();
  });
});
