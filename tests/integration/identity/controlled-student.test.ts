import { config } from "dotenv";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { users } from "@/db/schema";
import * as passwordCrypto from "@/lib/crypto";
import { REACTION_TRAINING_KEY } from "@/modules/training/constants";
import { changePassword } from "@/modules/identity/change-password.service";
import { createControlledStudent } from "@/modules/identity/create-controlled-student.service";
import { IdentityError } from "@/modules/identity/errors";
import { PRODUCT_PASSWORD_RULE_DESCRIPTION } from "@/modules/identity/password-policy";
import { assertStudentMayPerformWrites } from "@/modules/identity/password-change-guard";
import { registerParent } from "@/modules/identity/registration.service";
import { createInvitation } from "@/modules/identity/invitation.service";
import { startTrainingSession } from "@/modules/training/session.service";
import { bootstrapVerifiedParentWithInvite } from "../../helpers/family-access";
import { bootstrapAdmin } from "../../helpers/identity";
import { ensureReactionDefinitions } from "../../helpers/training";
import { closeTestDb, getTestDb, migrateTestDb, resetIdentityTables } from "../../helpers/db";

config({ path: ".env.local" });
config({ path: ".env" });

const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("controlled student and password change", () => {
  const db = getTestDb();

  beforeAll(async () => {
    process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";
    await migrateTestDb();
  });

  beforeEach(async () => {
    await resetIdentityTables(db);
    await ensureReactionDefinitions(db);
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("creates a 5-12 student with mustChangePassword and idempotent replay", async () => {
    const parentEmail = `parent-${randomUUID()}@test.local`;
    const { parentId } = await bootstrapVerifiedParentWithInvite(db, parentEmail);
    const username = `student_${randomUUID().slice(0, 8)}`;

    const created = await createControlledStudent(db, {
      parentId,
      username,
      birthDate: "2015-06-01",
      displayName: "Controlled Student",
      initialPassword: "Init1aPass",
      idempotencyKey: "create-student-1",
    });

    expect(created.mustChangePassword).toBe(true);
    expect(created.idempotentReplay).toBe(false);

    const replay = await createControlledStudent(db, {
      parentId,
      username: `other_${randomUUID().slice(0, 8)}`,
      birthDate: "2014-01-01",
      initialPassword: "Init1aPass",
      idempotencyKey: "create-student-1",
    });

    expect(replay.studentId).toBe(created.studentId);
    expect(replay.username).toBe(username);
    expect(replay.idempotentReplay).toBe(true);

    const [student] = await db.select().from(users).where(eq(users.id, created.studentId)).limit(1);
    expect(student?.mustChangePassword).toBe(true);
  });

  it("rejects controlled student creation outside ages 5-12", async () => {
    const parentEmail = `parent-${randomUUID()}@test.local`;
    const { parentId } = await bootstrapVerifiedParentWithInvite(db, parentEmail);

    await expect(
      createControlledStudent(db, {
        parentId,
        username: `teen_${randomUUID().slice(0, 8)}`,
        birthDate: "2010-01-01",
        initialPassword: "Init1aPass",
        idempotencyKey: "create-teen",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects invalid product passwords before hashing on register, create student, and change password", async () => {
    const hashSpy = vi.spyOn(passwordCrypto, "hashPassword");
    const { adminId } = await bootstrapAdmin(db);
    const invite = await createInvitation(db, {
      adminId,
      targetRole: "parent",
      idempotencyKey: "invite-invalid-password",
    });

    hashSpy.mockClear();
    await expect(
      registerParent(db, {
        invitationCode: invite.codePlaintext,
        displayName: "Parent",
        email: `invalid-reg-${randomUUID()}@test.local`,
        password: "ParentPass123!", // 13 chars — old length rule no longer accepted
        idempotencyKey: "reg-too-long",
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: PRODUCT_PASSWORD_RULE_DESCRIPTION,
    } satisfies Partial<IdentityError>);
    expect(hashSpy).not.toHaveBeenCalled();

    const parentEmail = `parent-${randomUUID()}@test.local`;
    const { parentId } = await bootstrapVerifiedParentWithInvite(db, parentEmail);

    hashSpy.mockClear();
    await expect(
      createControlledStudent(db, {
        parentId,
        username: `bad_${randomUUID().slice(0, 8)}`,
        birthDate: "2015-06-01",
        initialPassword: "nouppercase1",
        idempotencyKey: "create-bad-password",
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: PRODUCT_PASSWORD_RULE_DESCRIPTION,
    });
    expect(hashSpy).not.toHaveBeenCalled();

    const created = await createControlledStudent(db, {
      parentId,
      username: `ok_${randomUUID().slice(0, 8)}`,
      birthDate: "2015-06-01",
      initialPassword: "Init1aPass",
      idempotencyKey: "create-for-bad-change",
    });

    hashSpy.mockClear();
    await expect(
      changePassword(db, {
        userId: created.studentId,
        currentSessionId: "test-session",
        currentPassword: "Init1aPass",
        newPassword: "Abc12", // too short
        idempotencyKey: "change-too-short",
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: PRODUCT_PASSWORD_RULE_DESCRIPTION,
    });
    expect(hashSpy).not.toHaveBeenCalled();

    hashSpy.mockRestore();
  });

  it("blocks student writes until password change, then allows training", async () => {
    const parentEmail = `parent-${randomUUID()}@test.local`;
    const { parentId } = await bootstrapVerifiedParentWithInvite(db, parentEmail);
    const initialPassword = "Init1aPass";
    const newPassword = "Stud1aPass";

    const created = await createControlledStudent(db, {
      parentId,
      username: `student_${randomUUID().slice(0, 8)}`,
      birthDate: "2016-03-15",
      initialPassword,
      idempotencyKey: "create-for-training",
    });

    const [beforeChange] = await db
      .select()
      .from(users)
      .where(eq(users.id, created.studentId))
      .limit(1);
    expect(beforeChange?.mustChangePassword).toBe(true);

    expect(() => assertStudentMayPerformWrites(beforeChange!)).toThrow(
      expect.objectContaining({
        code: "PASSWORD_CHANGE_REQUIRED",
      } satisfies Partial<IdentityError>),
    );

    const changed = await changePassword(db, {
      userId: created.studentId,
      currentSessionId: "test-session",
      currentPassword: initialPassword,
      newPassword,
      idempotencyKey: "change-password-1",
    });

    expect(changed.mustChangePassword).toBe(false);
    expect(changed.idempotentReplay).toBe(false);

    const [afterChange] = await db
      .select()
      .from(users)
      .where(eq(users.id, created.studentId))
      .limit(1);
    expect(afterChange?.mustChangePassword).toBe(false);
    expect(afterChange?.passwordChangedAt).toBeTruthy();
    expect(afterChange!.authorizationEpoch).toBeGreaterThan(beforeChange!.authorizationEpoch);

    expect(() => assertStudentMayPerformWrites(afterChange!)).not.toThrow();

    const started = await startTrainingSession(db, {
      studentId: created.studentId,
      trainingKey: REACTION_TRAINING_KEY,
      idempotencyKey: "start-after-change",
    });

    expect(started.sessionId).toBeTruthy();
    expect(started.idempotentReplay).toBe(false);

    const replay = await changePassword(db, {
      userId: created.studentId,
      currentSessionId: "test-session",
      currentPassword: initialPassword,
      newPassword,
      idempotencyKey: "change-password-1",
    });
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.sessionCookie.value).toBeTruthy();
  });

  it("lets parent change own password with current-password checks and rejects same password", async () => {
    const parentEmail = `parent-${randomUUID()}@test.local`;
    const { parentId } = await bootstrapVerifiedParentWithInvite(db, parentEmail);
    const [before] = await db.select().from(users).where(eq(users.id, parentId)).limit(1);

    await expect(
      changePassword(db, {
        userId: parentId,
        currentSessionId: "parent-session",
        currentPassword: "WrongPass1a",
        newPassword: "Parent2bYz",
        idempotencyKey: "parent-change-wrong",
      }),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });

    await expect(
      changePassword(db, {
        userId: parentId,
        currentSessionId: "parent-session",
        currentPassword: "Parent1aXy",
        newPassword: "Parent1aXy",
        idempotencyKey: "parent-change-same",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    const changed = await changePassword(db, {
      userId: parentId,
      currentSessionId: "parent-session",
      currentPassword: "Parent1aXy",
      newPassword: "Parent2bYz",
      idempotencyKey: "parent-change-ok",
    });

    expect(changed.userId).toBe(parentId);
    expect(changed.mustChangePassword).toBe(false);
    expect(changed.sessionCookie.value).toBeTruthy();

    const [after] = await db.select().from(users).where(eq(users.id, parentId)).limit(1);
    expect(after!.authorizationEpoch).toBeGreaterThan(before!.authorizationEpoch);
  });

  it("rejects password change for non self roles via service role gate", async () => {
    const { adminId, password: adminPassword } = await bootstrapAdmin(db);

    await expect(
      changePassword(db, {
        userId: adminId,
        currentSessionId: "admin-session",
        currentPassword: adminPassword,
        newPassword: "Abc123",
        idempotencyKey: "admin-change",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
