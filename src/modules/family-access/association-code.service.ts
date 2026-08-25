import { and, eq, isNull } from "drizzle-orm";

import type { Database } from "@/db";
import { studentAssociationCodes } from "@/db/schema";
import { appendAuditEvent } from "@/modules/audit/append-audit-event";
import {
  generateAssociationCodePlaintext,
  hashAssociationCode,
} from "@/lib/crypto";
import { ASSOCIATION_CODE_TTL_MS } from "@/modules/family-access/constants";
import { FamilyAccessError } from "@/modules/family-access/errors";

export type IssueAssociationCodeInput = {
  studentId: string;
  idempotencyKey: string;
  requestId?: string;
};

export type IssueAssociationCodeResult = {
  associationCodeId: string;
  /** Plaintext returned once; must not be logged or persisted. */
  codePlaintext: string;
  expiresAt: Date;
  idempotentReplay: boolean;
};

export async function issueAssociationCode(
  db: Database,
  input: IssueAssociationCodeInput,
): Promise<IssueAssociationCodeResult> {
  if (input.idempotencyKey) {
    const [existing] = await db
      .select()
      .from(studentAssociationCodes)
      .where(eq(studentAssociationCodes.issueIdempotencyKey, input.idempotencyKey))
      .limit(1);

    if (existing) {
      return {
        associationCodeId: existing.id,
        codePlaintext: "",
        expiresAt: existing.expiresAt,
        idempotentReplay: true,
      };
    }
  }

  const codePlaintext = generateAssociationCodePlaintext();
  const codeHash = hashAssociationCode(codePlaintext);
  const expiresAt = new Date(Date.now() + ASSOCIATION_CODE_TTL_MS);

  return db.transaction(async (tx) => {
    await tx
      .update(studentAssociationCodes)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(studentAssociationCodes.studentId, input.studentId),
          isNull(studentAssociationCodes.consumedAt),
          isNull(studentAssociationCodes.revokedAt),
        ),
      );

    const [created] = await tx
      .insert(studentAssociationCodes)
      .values({
        studentId: input.studentId,
        codeHash,
        expiresAt,
        issueIdempotencyKey: input.idempotencyKey,
      })
      .returning();

    if (!created) {
      throw new Error("Failed to issue association code");
    }

    await appendAuditEvent(tx, {
      actorId: input.studentId,
      action: "association_code.issued",
      resourceType: "student_association_code",
      resourceId: created.id,
      requestId: input.requestId,
      idempotencyKey: `audit:assoc-issue:${input.idempotencyKey}`,
      metadata: { expiresAt: expiresAt.toISOString() },
    });

    return {
      associationCodeId: created.id,
      codePlaintext,
      expiresAt: created.expiresAt,
      idempotentReplay: false,
    };
  });
}

export type ResolvedAssociationCode = {
  associationCodeId: string;
  studentId: string;
  expiresAt: Date;
};

export async function resolveAssociationCodeByPlaintext(
  db: Database,
  codePlaintext: string,
): Promise<ResolvedAssociationCode> {
  const codeHash = hashAssociationCode(codePlaintext);
  const [row] = await db
    .select()
    .from(studentAssociationCodes)
    .where(eq(studentAssociationCodes.codeHash, codeHash))
    .limit(1);

  if (!row) {
    throw new FamilyAccessError("ASSOCIATION_CODE_INVALID", "Association code is invalid");
  }

  if (row.revokedAt) {
    throw new FamilyAccessError("ASSOCIATION_CODE_REVOKED", "Association code has been revoked");
  }

  if (row.consumedAt) {
    throw new FamilyAccessError("ASSOCIATION_CODE_CONSUMED", "Association code has already been used");
  }

  if (row.expiresAt.getTime() <= Date.now()) {
    throw new FamilyAccessError("ASSOCIATION_CODE_EXPIRED", "Association code has expired");
  }

  return {
    associationCodeId: row.id,
    studentId: row.studentId,
    expiresAt: row.expiresAt,
  };
}

export async function revokeActiveAssociationCodes(
  db: Database,
  studentId: string,
  idempotencyKey: string,
  requestId?: string,
): Promise<number> {
  const revokedAt = new Date();
  const updated = await db
    .update(studentAssociationCodes)
    .set({ revokedAt })
    .where(
      and(
        eq(studentAssociationCodes.studentId, studentId),
        isNull(studentAssociationCodes.consumedAt),
        isNull(studentAssociationCodes.revokedAt),
      ),
    )
    .returning({ id: studentAssociationCodes.id });

  if (updated.length > 0) {
    await appendAuditEvent(db, {
      actorId: studentId,
      action: "association_code.revoked",
      resourceType: "student",
      resourceId: studentId,
      requestId,
      idempotencyKey: `audit:assoc-revoke:${idempotencyKey}`,
      metadata: { count: updated.length },
    });
  }

  return updated.length;
}
