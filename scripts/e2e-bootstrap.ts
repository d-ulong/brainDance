import { config } from "dotenv";
import { writeFileSync } from "node:fs";
import path from "node:path";

import { createDb, closeDb } from "../src/db";
import { users } from "../src/db/schema";
import { requireDatabaseUrl } from "../src/lib/env";
import { hashPassword } from "../src/lib/crypto";
import { changePassword } from "../src/modules/identity/change-password.service";
import { createControlledStudent } from "../src/modules/identity/create-controlled-student.service";
import { login } from "../src/modules/identity/login.service";
import { seedM5TrainingDefinitions } from "../src/modules/training/definition.service";
import {
  E2E_ADMIN_EMAIL,
  E2E_ADMIN_ID,
  E2E_ADMIN_TOTP_SECRET,
  isolatedE2eTotpConfig,
} from "../tests/helpers/e2e-auth-config";
import { migrateTestDb } from "../tests/helpers/db";
import { bootstrapVerifiedParentWithInvite } from "../tests/helpers/family-access";
import { bootstrapCatalogItem, seedRebuildSafeStudentBalance } from "../tests/helpers/redemption";

config({ path: ".env.local" });
config({ path: ".env" });

const FIXTURE_PATH = path.join(process.cwd(), "tests/e2e/.fixture.json");

async function main() {
  process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";
  process.env.ADMIN_TOTP_SECRETS = isolatedE2eTotpConfig();
  await migrateTestDb();

  const db = createDb(requireDatabaseUrl());
  const runId = crypto.randomUUID().slice(0, 8);

  const adminEmail = E2E_ADMIN_EMAIL;
  const adminPassword = "E2eAdmin-Test-123456";
  const adminPasswordHash = await hashPassword(adminPassword);
  await db
    .insert(users)
    .values({
      id: E2E_ADMIN_ID,
      role: "admin",
      email: adminEmail,
      displayName: "E2E Admin",
      passwordHash: adminPasswordHash,
      status: "active",
      contactVerifiedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: users.id,
      set: {
        passwordHash: adminPasswordHash,
        status: "active",
        lockedUntil: null,
        adminTotpLastStep: null,
      },
    });
  await seedM5TrainingDefinitions(db);

  const parentEmail = `e2e-parent-${runId}@test.local`;
  const parentPassword = "Parent1aXy";
  const { parentId } = await bootstrapVerifiedParentWithInvite(db, parentEmail);

  const studentUsername = `e2e_student_${runId}`;
  const initialPassword = "Init1aPass";
  const studentPassword = "Stud1aPass";

  const created = await createControlledStudent(db, {
    parentId,
    username: studentUsername,
    birthDate: "2015-06-01",
    displayName: "E2E Student",
    initialPassword,
    idempotencyKey: `e2e-create-student-${runId}`,
  });

  const studentLogin = await login(db, {
    identifier: studentUsername,
    password: initialPassword,
    idempotencyKey: `e2e-initial-login-${runId}`,
  });
  await changePassword(db, {
    userId: created.studentId,
    currentSessionId: studentLogin.sessionId,
    currentPassword: initialPassword,
    newPassword: studentPassword,
    idempotencyKey: `e2e-change-password-${runId}`,
  });

  const secondCreated = await createControlledStudent(db, {
    parentId,
    username: `e2e_student_second_${runId}`,
    birthDate: "2014-06-01",
    displayName: "E2E Second Student",
    initialPassword,
    idempotencyKey: `e2e-create-second-student-${runId}`,
  });

  const secondLogin = await login(db, {
    identifier: `e2e_student_second_${runId}`,
    password: initialPassword,
    idempotencyKey: `e2e-second-initial-login-${runId}`,
  });
  await changePassword(db, {
    userId: secondCreated.studentId,
    currentSessionId: secondLogin.sessionId,
    currentPassword: initialPassword,
    newPassword: studentPassword,
    idempotencyKey: `e2e-change-second-password-${runId}`,
  });

  // Parent-created students are already linked by the creation transaction.

  // Ledger-backed seed so lifecycle-worker `points.settled` rebuild keeps the balance.
  await seedRebuildSafeStudentBalance(db, {
    parentId,
    studentId: created.studentId,
    balance: 100,
  });
  const { item: catalogItem } = await bootstrapCatalogItem(db, {
    parentId,
    studentId: created.studentId,
    title: "E2E 测试奖励",
    cost: 10,
    idempotencyKey: `e2e-catalog-${runId}`,
  });

  writeFileSync(
    FIXTURE_PATH,
    JSON.stringify(
      {
        adminEmail,
        adminPassword,
        adminTotpSecret: E2E_ADMIN_TOTP_SECRET,
        parentEmail,
        parentPassword,
        parentId,
        studentUsername,
        studentPassword,
        studentId: created.studentId,
        secondStudentId: secondCreated.studentId,
        catalogItemId: catalogItem.id,
      },
      null,
      2,
    ),
  );

  await closeDb();
  console.log(`E2E fixture written to ${FIXTURE_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
