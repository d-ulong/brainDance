import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { users } from "@/db/schema";
import { REACTION_TRAINING_KEY } from "@/modules/training/constants";
import { changePassword } from "@/modules/identity/change-password.service";
import { createControlledStudent } from "@/modules/identity/create-controlled-student.service";
import { IdentityError } from "@/modules/identity/errors";
import { assertStudentMayPerformWrites } from "@/modules/identity/password-change-guard";
import { startTrainingSession } from "@/modules/training/session.service";
import { bootstrapVerifiedParentWithInvite } from "../../helpers/family-access";
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
    const parentEmail = `parent-${crypto.randomUUID()}@test.local`;
    const { parentId } = await bootstrapVerifiedParentWithInvite(db, parentEmail);
    const username = `student_${crypto.randomUUID().slice(0, 8)}`;

    const created = await createControlledStudent(db, {
      parentId,
      username,
      birthDate: "2015-06-01",
      displayName: "Controlled Student",
      initialPassword: "InitialPass123!Go",
      idempotencyKey: "create-student-1",
    });

    expect(created.mustChangePassword).toBe(true);
    expect(created.idempotentReplay).toBe(false);

    const replay = await createControlledStudent(db, {
      parentId,
      username: `other_${crypto.randomUUID().slice(0, 8)}`,
      birthDate: "2014-01-01",
      initialPassword: "InitialPass123!Go",
      idempotencyKey: "create-student-1",
    });

    expect(replay.studentId).toBe(created.studentId);
    expect(replay.username).toBe(username);
    expect(replay.idempotentReplay).toBe(true);

    const [student] = await db.select().from(users).where(eq(users.id, created.studentId)).limit(1);
    expect(student?.mustChangePassword).toBe(true);
  });

  it("rejects controlled student creation outside ages 5-12", async () => {
    const parentEmail = `parent-${crypto.randomUUID()}@test.local`;
    const { parentId } = await bootstrapVerifiedParentWithInvite(db, parentEmail);

    await expect(
      createControlledStudent(db, {
        parentId,
        username: `teen_${crypto.randomUUID().slice(0, 8)}`,
        birthDate: "2010-01-01",
        initialPassword: "InitialPass123!Go",
        idempotencyKey: "create-teen",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("blocks student writes until password change, then allows training", async () => {
    const parentEmail = `parent-${crypto.randomUUID()}@test.local`;
    const { parentId } = await bootstrapVerifiedParentWithInvite(db, parentEmail);
    const initialPassword = "InitialPass123!Go";
    const newPassword = "UpdatedPass123!New";

    const created = await createControlledStudent(db, {
      parentId,
      username: `student_${crypto.randomUUID().slice(0, 8)}`,
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
  });
});
