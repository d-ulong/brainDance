import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { deletionCapabilities } from "@/db/schema";
import { hashDeletionCapabilityToken } from "@/lib/crypto";
import { DELETION_TARGET_TYPE } from "@/modules/data-lifecycle/constants";
import {
  cancelDeletionRequest,
  confirmDeletionRequest,
  createDeletionRequest,
} from "@/modules/data-lifecycle/deletion-request.service";
import {
  DELETION_CAPABILITY_TTL_MS,
  findValidDeletionCapability,
  issueDeletionCapability,
} from "@/modules/data-lifecycle/deletion-capability.service";
import { login, validateSession } from "@/modules/identity/login.service";
import { upsertDailyReflection } from "@/modules/reflection-privacy/upsert-daily-reflection.service";
import { toFamilyDate } from "@/modules/time-policy/to-family-date";
import { seedStudentUser } from "../../helpers/family-access";
import { createTestArtifactStore } from "../../helpers/data-lifecycle";
import { closeTestDb, getTestDb, migrateTestDb, resetIdentityTables } from "../../helpers/db";

config({ path: ".env.local" });
config({ path: ".env" });

const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("M6 P3 F02 deletion-management capability", () => {
  const db = getTestDb();
  const artifactStore = createTestArtifactStore();

  beforeAll(async () => {
    process.env.SESSION_SECRET ??= "test-session-secret-at-least-32-characters-long";
    await migrateTestDb();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    await resetIdentityTables(db);
  });

  async function freezeStudent(password = "StudentPass123!Student") {
    const student = await seedStudentUser(db, {
      username: `f02_${crypto.randomUUID().slice(0, 8)}`,
      password,
    });
    const created = await createDeletionRequest(db, {
      targetType: DELETION_TARGET_TYPE.STUDENT_ACCOUNT,
      targetId: student.studentId,
      requestedBy: student.studentId,
      requesterRole: "student",
      idempotencyKey: `f02-freeze-${crypto.randomUUID().slice(0, 8)}`,
      artifactStore,
    });
    return { student, request: created };
  }

  it("F02: wrong password cannot issue a capability", async () => {
    const { student, request } = await freezeStudent();

    await expect(
      issueDeletionCapability(db, {
        identifier: student.username,
        password: "WrongPass123!Wrong",
        requestId: request.requestId,
      }),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
  });

  it("F02: capability is bound to its deletion request and cannot cancel another", async () => {
    const { student: studentA, request: requestA } = await freezeStudent();
    const { request: requestB } = await freezeStudent();

    const issued = await issueDeletionCapability(db, {
      identifier: studentA.username,
      password: "StudentPass123!Student",
      requestId: requestA.requestId,
    });

    // The capability for A must not authorize B's request.
    await expect(
      cancelDeletionRequest(db, {
        requestId: requestB.requestId,
        capabilityToken: issued.capabilityToken,
        idempotencyKey: "f02-cross-cancel",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    // It cancels the bound request.
    const cancelled = await cancelDeletionRequest(db, {
      requestId: requestA.requestId,
      capabilityToken: issued.capabilityToken,
      idempotencyKey: "f02-bound-cancel",
    });
    expect(cancelled.status).toBe("cancelled");
  });

  it("F02: capability cannot be reused after the request leaves frozen", async () => {
    const { student, request } = await freezeStudent();

    const issued = await issueDeletionCapability(db, {
      identifier: student.username,
      password: "StudentPass123!Student",
      requestId: request.requestId,
    });

    const cancelled = await cancelDeletionRequest(db, {
      requestId: request.requestId,
      capabilityToken: issued.capabilityToken,
      idempotencyKey: "f02-cancel-once",
    });
    expect(cancelled.status).toBe("cancelled");

    // After cancel the request is terminal; the same capability cannot confirm.
    await expect(
      confirmDeletionRequest(db, {
        requestId: request.requestId,
        capabilityToken: issued.capabilityToken,
        idempotencyKey: "f02-confirm-after-cancel",
      }),
    ).rejects.toMatchObject({ code: "STATE_CONFLICT" });
  });

  it("F02: capability authorizes student confirm; ordinary session stays fail-closed", async () => {
    const { student, request } = await freezeStudent();

    // Normal login remains blocked while frozen.
    await expect(
      login(db, {
        identifier: student.username,
        password: "StudentPass123!Student",
        idempotencyKey: "f02-login-blocked",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const issued = await issueDeletionCapability(db, {
      identifier: student.username,
      password: "StudentPass123!Student",
      requestId: request.requestId,
    });

    const confirmed = await confirmDeletionRequest(db, {
      requestId: request.requestId,
      capabilityToken: issued.capabilityToken,
      idempotencyKey: "f02-confirm",
    });
    expect(confirmed.studentConfirmedAt).toBeTruthy();

    // Still frozen: no generic session and ordinary writes remain blocked.
    const session = await validateSession(db, crypto.randomUUID());
    expect(session).toBeNull();

    await expect(
      upsertDailyReflection(db, {
        studentId: student.studentId,
        familyDate: toFamilyDate(),
        visibility: "normal",
        body: "blocked while frozen",
        idempotencyKey: "f02-write-blocked",
      }),
    ).rejects.toMatchObject({ code: "FROZEN" });
  });

  it("F02: capability expires and validation fails after TTL", async () => {
    const { student, request } = await freezeStudent();

    const issued = await issueDeletionCapability(db, {
      identifier: student.username,
      password: "StudentPass123!Student",
      requestId: request.requestId,
    });

    const capability = await findValidDeletionCapability(
      db,
      request.requestId,
      issued.capabilityToken,
    );
    expect(capability).toBeTruthy();

    // Simulate TTL lapse in the DB directly.
    await db
      .update(deletionCapabilities)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(
        eq(deletionCapabilities.tokenHash, hashDeletionCapabilityToken(issued.capabilityToken)),
      );

    expect(
      await findValidDeletionCapability(db, request.requestId, issued.capabilityToken),
    ).toBeNull();

    await expect(
      cancelDeletionRequest(db, {
        requestId: request.requestId,
        capabilityToken: issued.capabilityToken,
        idempotencyKey: "f02-expired-capability",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("F02: capability TTL is bounded", async () => {
    expect(DELETION_CAPABILITY_TTL_MS).toBeLessThanOrEqual(30 * 60 * 1000);
  });
});
