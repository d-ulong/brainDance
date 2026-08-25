import { users } from "@/db/schema";
import { hashPassword } from "@/lib/crypto";
import { createInvitation } from "@/modules/identity/invitation.service";

import type { TestDb } from "./db";
import { bootstrapAdmin, createVerifiedParent } from "./identity";

export async function seedStudentUser(
  db: TestDb,
  input: {
    username: string;
    password: string;
    displayName?: string;
    birthDate?: string;
  },
) {
  const passwordHash = await hashPassword(input.password);
  const now = new Date();

  const [student] = await db
    .insert(users)
    .values({
      role: "student",
      displayName: input.displayName ?? "Test Student",
      username: input.username,
      birthDate: input.birthDate ?? "2015-06-01",
      passwordHash,
      status: "active",
      contactVerifiedAt: now,
    })
    .returning({ id: users.id });

  if (!student) {
    throw new Error("Failed to seed student");
  }

  return { studentId: student.id, username: input.username, password: input.password };
}

export async function bootstrapVerifiedParentWithInvite(db: TestDb, email: string) {
  const { adminId } = await bootstrapAdmin(db, `admin+${email}@test.local`);
  const invite = await createInvitation(db, {
    adminId,
    targetRole: "parent",
    idempotencyKey: `invite:${email}`,
  });

  const parent = await createVerifiedParent(db, {
    email,
    password: "ParentPass123!Parent",
    invitationCode: invite.codePlaintext,
    displayName: "Test Parent",
  });

  return { parentId: parent.userId, invite };
}
