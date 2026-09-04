import { eq } from "drizzle-orm";

import type { Database } from "@/db";
import { auditEvents, users } from "@/db/schema";
import { hashPassword } from "@/lib/crypto";
import { appendAuditEvent } from "@/modules/audit/append-audit-event";
import { FamilyAccessError } from "@/modules/family-access/errors";
import { assertProductPassword } from "@/modules/identity/password-policy";
import { resolveAgeBand } from "@/modules/time-policy/resolve-age-band";

export type CreateControlledStudentInput = {
  parentId: string;
  username: string;
  birthDate: string;
  displayName?: string;
  initialPassword: string;
  idempotencyKey: string;
  requestId?: string;
};

export type CreateControlledStudentResult = {
  studentId: string;
  username: string;
  mustChangePassword: true;
  idempotentReplay: boolean;
};

function assertControlledStudentAge(birthDate: string): void {
  const parsed = new Date(`${birthDate}T12:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new FamilyAccessError("VALIDATION_ERROR", "Invalid birth date");
  }

  const band = resolveAgeBand(parsed);
  if (band === "13-18") {
    throw new FamilyAccessError(
      "VALIDATION_ERROR",
      "Controlled student creation is only available for ages 5-12",
    );
  }

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const nowParts = formatter.formatToParts(new Date());
  const birthParts = formatter.formatToParts(parsed);
  const nowYear = Number(nowParts.find((p) => p.type === "year")?.value);
  const nowMonth = Number(nowParts.find((p) => p.type === "month")?.value);
  const nowDay = Number(nowParts.find((p) => p.type === "day")?.value);
  const birthYear = Number(birthParts.find((p) => p.type === "year")?.value);
  const birthMonth = Number(birthParts.find((p) => p.type === "month")?.value);
  const birthDay = Number(birthParts.find((p) => p.type === "day")?.value);

  let age = nowYear - birthYear;
  if (nowMonth < birthMonth || (nowMonth === birthMonth && nowDay < birthDay)) {
    age -= 1;
  }

  if (age < 5 || age > 12) {
    throw new FamilyAccessError(
      "VALIDATION_ERROR",
      "Controlled student creation is only available for ages 5-12",
    );
  }
}

async function findControlledStudentReplay(
  db: Database,
  input: CreateControlledStudentInput,
): Promise<CreateControlledStudentResult | null> {
  const auditKey = `audit:family-student-create:${input.parentId}:${input.idempotencyKey}`;
  const [existingAudit] = await db
    .select({ resourceId: auditEvents.resourceId, metadata: auditEvents.metadata })
    .from(auditEvents)
    .where(eq(auditEvents.idempotencyKey, auditKey))
    .limit(1);

  if (!existingAudit?.resourceId) {
    return null;
  }

  const username =
    existingAudit.metadata && typeof existingAudit.metadata.username === "string"
      ? existingAudit.metadata.username
      : input.username;

  return {
    studentId: existingAudit.resourceId,
    username,
    mustChangePassword: true,
    idempotentReplay: true,
  };
}

export async function createControlledStudent(
  db: Database,
  input: CreateControlledStudentInput,
): Promise<CreateControlledStudentResult> {
  const replay = await findControlledStudentReplay(db, input);
  if (replay) {
    return replay;
  }

  const [parent] = await db.select().from(users).where(eq(users.id, input.parentId)).limit(1);
  if (!parent || parent.role !== "parent") {
    throw new FamilyAccessError("FORBIDDEN", "Only verified parents can create students");
  }
  if (!parent.contactVerifiedAt) {
    throw new FamilyAccessError("CONTACT_NOT_VERIFIED", "Parent contact must be verified");
  }

  const username = input.username.trim();
  if (username.length < 3) {
    throw new FamilyAccessError("VALIDATION_ERROR", "Username must be at least 3 characters");
  }

  assertControlledStudentAge(input.birthDate);
  assertProductPassword(input.initialPassword);

  const [existingUsername] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, username))
    .limit(1);
  if (existingUsername) {
    throw new FamilyAccessError("VALIDATION_ERROR", "Username is already taken");
  }

  const passwordHash = await hashPassword(input.initialPassword);
  const now = new Date();

  return db.transaction(async (tx) => {
    const replayInTx = await findControlledStudentReplay(tx, input);
    if (replayInTx) {
      return replayInTx;
    }

    const [created] = await tx
      .insert(users)
      .values({
        role: "student",
        displayName: input.displayName?.trim() || username,
        username,
        birthDate: input.birthDate,
        passwordHash,
        status: "active",
        contactVerifiedAt: now,
        mustChangePassword: true,
      })
      .returning({ id: users.id });

    if (!created) {
      throw new Error("Failed to create controlled student");
    }

    await appendAuditEvent(tx, {
      actorId: input.parentId,
      action: "family.student.created",
      resourceType: "user",
      resourceId: created.id,
      requestId: input.requestId,
      idempotencyKey: `audit:family-student-create:${input.parentId}:${input.idempotencyKey}`,
      metadata: {
        username,
        birthDate: input.birthDate,
        mustChangePassword: true,
      },
    });

    return {
      studentId: created.id,
      username,
      mustChangePassword: true as const,
      idempotentReplay: false,
    };
  });
}
