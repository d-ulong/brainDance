import { login } from "@/modules/identity/login.service";

import type { TestDb } from "../../../helpers/db";
import { bootstrapVerifiedParentWithInvite } from "../../../helpers/family-access";
import { seedStudentUser } from "../../../helpers/family-access";
import {
  acceptRelationshipRequest,
  createRelationshipRequest,
} from "@/modules/family-access/relationship-request.service";
import { issueAssociationCode } from "@/modules/family-access/association-code.service";

import { setMockSessionCookie } from "./auth-mock";

export async function bootstrapLinkedParentStudent(db: TestDb) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const email = `parent_${suffix}@test.local`;
  const { parentId } = await bootstrapVerifiedParentWithInvite(db, email);
  const username = `student_${suffix}`;
  const password = "StudentPass123!Student";
  const { studentId } = await seedStudentUser(db, { username, password });

  const code = await issueAssociationCode(db, {
    studentId,
    idempotencyKey: `issue-${suffix}`,
  });

  const request = await createRelationshipRequest(db, {
    parentId,
    associationCodePlaintext: code.codePlaintext,
    idempotencyKey: `req-${suffix}`,
  });

  await acceptRelationshipRequest(db, {
    studentId,
    requestId: request.requestId,
    idempotencyKey: `accept-${suffix}`,
  });

  const parentSession = await login(db, {
    identifier: email,
    password: "Parent1aXy",
    idempotencyKey: `login-parent:${suffix}`,
  });

  const studentSession = await login(db, {
    identifier: username,
    password,
    idempotencyKey: `login-student:${suffix}`,
  });

  return {
    parentId,
    studentId,
    parentEmail: email,
    studentUsername: username,
    studentPassword: password,
    parentSession,
    studentSession,
  };
}

export function withSessionCookie(session: { sessionCookie: { value: string } }) {
  setMockSessionCookie(session.sessionCookie.value);
}
