import { config } from "dotenv";
import { writeFileSync } from "node:fs";
import path from "node:path";

import { createDb, closeDb } from "../src/db";
import { requireDatabaseUrl } from "../src/lib/env";
import { issueAssociationCode } from "../src/modules/family-access/association-code.service";
import {
  acceptRelationshipRequest,
  createRelationshipRequest,
} from "../src/modules/family-access/relationship-request.service";
import { seedReactionDefinitions } from "../src/modules/training/definition.service";
import { seedAdminUser } from "../src/modules/identity/seed-admin";
import { migrateTestDb } from "../tests/helpers/db";
import {
  bootstrapVerifiedParentWithInvite,
  seedStudentUser,
} from "../tests/helpers/family-access";

config({ path: ".env.local" });
config({ path: ".env" });

const FIXTURE_PATH = path.join(process.cwd(), "tests/e2e/.fixture.json");

async function main() {
  process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";
  await migrateTestDb();

  const db = createDb(requireDatabaseUrl());
  const runId = crypto.randomUUID().slice(0, 8);

  await seedAdminUser(db, {
    email: process.env.SEED_ADMIN_EMAIL ?? "admin@local.braindance",
    password: process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe-Admin-123456",
    displayName: "E2E Admin",
  });
  await seedReactionDefinitions(db);

  const parentEmail = `e2e-parent-${runId}@test.local`;
  const parentPassword = "ParentPass123!Parent";
  const { parentId } = await bootstrapVerifiedParentWithInvite(db, parentEmail);

  const studentUsername = `e2e_student_${runId}`;
  const studentPassword = "StudentPass123!Student";
  const student = await seedStudentUser(db, {
    username: studentUsername,
    password: studentPassword,
    birthDate: "2015-06-01",
    displayName: "E2E Student",
  });

  const code = await issueAssociationCode(db, {
    studentId: student.studentId,
    idempotencyKey: `e2e-issue-${runId}`,
  });
  const request = await createRelationshipRequest(db, {
    parentId,
    associationCodePlaintext: code.codePlaintext,
    idempotencyKey: `e2e-req-${runId}`,
  });
  await acceptRelationshipRequest(db, {
    studentId: student.studentId,
    requestId: request.requestId,
    idempotencyKey: `e2e-accept-${runId}`,
  });

  writeFileSync(
    FIXTURE_PATH,
    JSON.stringify(
      {
        parentEmail,
        parentPassword,
        studentUsername,
        studentPassword,
        studentId: student.studentId,
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
