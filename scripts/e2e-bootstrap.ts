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
import { seedReactionDefinitions } from "../src/modules/training/definition.service";
import { seedAdminUser } from "../src/modules/identity/seed-admin";
import { migrateTestDb } from "../tests/helpers/db";
import { bootstrapVerifiedParentWithInvite } from "../tests/helpers/family-access";

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
  await seedReactionDefinitions(db);

  const parentEmail = `e2e-parent-${runId}@test.local`;
  const parentPassword = "ParentPass123!Parent";
  const { parentId } = await bootstrapVerifiedParentWithInvite(db, parentEmail);

  const studentUsername = `e2e_student_${runId}`;
  const initialPassword = "InitialPass123!Go";
  const studentPassword = "StudentPass123!Student";

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

  writeFileSync(
    FIXTURE_PATH,
    JSON.stringify(
      {
        adminEmail,
        adminPassword,
        parentEmail,
        parentPassword,
        studentUsername,
        studentPassword,
        studentId: created.studentId,
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
