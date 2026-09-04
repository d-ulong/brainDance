import { eq } from "drizzle-orm";
import { config } from "dotenv";
import { writeFileSync } from "node:fs";
import path from "node:path";

import { createDb, closeDb } from "../src/db";
import { users } from "../src/db/schema";
import { requireDatabaseUrl } from "../src/lib/env";
import { hashPassword } from "../src/lib/crypto";
import { changePassword } from "../src/modules/identity/change-password.service";
import { createControlledStudent } from "../src/modules/identity/create-controlled-student.service";
import { issueAssociationCode } from "../src/modules/family-access/association-code.service";
import {
  acceptRelationshipRequest,
  createRelationshipRequest,
} from "../src/modules/family-access/relationship-request.service";
import { seedM5TrainingDefinitions } from "../src/modules/training/definition.service";
import { seedAdminUser } from "../src/modules/identity/seed-admin";
import { migrateTestDb } from "../tests/helpers/db";
import { bootstrapVerifiedParentWithInvite } from "../tests/helpers/family-access";
import { bootstrapCatalogItem, seedRebuildSafeStudentBalance } from "../tests/helpers/redemption";

config({ path: ".env.local" });
config({ path: ".env" });

const FIXTURE_PATH = path.join(process.cwd(), "tests/e2e/.fixture.json");

async function main() {
  process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";
  await migrateTestDb();

  const db = createDb(requireDatabaseUrl());
  const runId = crypto.randomUUID().slice(0, 8);

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@local.braindance";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe-Admin-123456";

  await seedAdminUser(db, {
    email: adminEmail,
    password: adminPassword,
    displayName: "E2E Admin",
  });
  const adminPasswordHash = await hashPassword(adminPassword);
  await db
    .update(users)
    .set({
      passwordHash: adminPasswordHash,
      status: "active",
      lockedUntil: null,
    })
    .where(eq(users.email, adminEmail.trim().toLowerCase()));
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

  await changePassword(db, {
    userId: created.studentId,
    currentSessionId: "bootstrap-session",
    currentPassword: initialPassword,
    newPassword: studentPassword,
    idempotencyKey: `e2e-change-password-${runId}`,
  });

  const code = await issueAssociationCode(db, {
    studentId: created.studentId,
    idempotencyKey: `e2e-issue-${runId}`,
  });
  const request = await createRelationshipRequest(db, {
    parentId,
    associationCodePlaintext: code.codePlaintext,
    idempotencyKey: `e2e-req-${runId}`,
  });
  await acceptRelationshipRequest(db, {
    studentId: created.studentId,
    requestId: request.requestId,
    idempotencyKey: `e2e-accept-${runId}`,
  });

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
        parentEmail,
        parentPassword,
        parentId,
        studentUsername,
        studentPassword,
        studentId: created.studentId,
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
