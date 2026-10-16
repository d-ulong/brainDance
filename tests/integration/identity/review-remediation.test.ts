import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  contactVerificationCodes,
  deletionRequests,
  loginSecurityEvents,
  mediaObjects,
  mediaPurgeIntents,
  sessions,
  users,
} from "@/db/schema";
import { hashPassword } from "@/lib/crypto";
import { refreshSessionCookieAfterEpochChange } from "@/lib/auth-request";
import { login, validateSession } from "@/modules/identity/login.service";
import { assertSubjectAccess } from "@/modules/data-lifecycle/subject-access.service";
import { totpForStep } from "@/modules/identity/totp";
import { issueContactVerification, verifyContact } from "@/modules/identity/verification.service";
import { completeGoal, createGoals, listGoals } from "@/modules/goals/goal.service";
import { handleMediaPurgeRequestedV1 } from "@/modules/family-content/media-purge.service";
import { createMemoryMediaStore } from "@/modules/family-content/private-media-store";
import { closeTestDb, getTestDb, migrateTestDb, resetIdentityTables } from "../../helpers/db";

const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("review identity safeguards", () => {
  const db = getTestDb();
  beforeAll(migrateTestDb);
  beforeEach(async () => {
    vi.stubEnv("LOCAL_PILOT_MODE", "false");
    await resetIdentityTables(db);
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(closeTestDb);

  async function account(
    role: "parent" | "admin" | "student" = "parent",
    birthDate: string | null = null,
  ) {
    const [row] = await db
      .insert(users)
      .values({
        role,
        displayName: "Security fixture",
        email: "security@test.local",
        username: "security-student",
        birthDate,
        passwordHash: await hashPassword("Password123!"),
        status: "active",
      })
      .returning();
    return row!;
  }

  it("locks after five failed passwords sharing the same client key", async () => {
    const user = await account();
    for (let index = 0; index < 5; index++) {
      await expect(
        login(db, {
          identifier: user.email!,
          password: "wrong",
          idempotencyKey: "same-client-key",
        }),
      ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    }
    const failures = await db
      .select()
      .from(loginSecurityEvents)
      .where(
        and(
          eq(loginSecurityEvents.accountKey, `user:${user.id}`),
          eq(loginSecurityEvents.eventType, "login_failed"),
        ),
      );
    expect(failures).toHaveLength(5);
    await expect(
      login(db, { identifier: user.username!, password: "Password123!" }),
    ).rejects.toMatchObject({ code: "ACCOUNT_LOCKED" });
  });

  it("serializes concurrent failures so the account threshold cannot be overshot", async () => {
    const user = await account();
    const attempts = await Promise.allSettled(
      Array.from({ length: 7 }, () =>
        login(db, { identifier: user.email!, password: "wrong", idempotencyKey: "same-key" }),
      ),
    );
    expect(attempts.every((result) => result.status === "rejected")).toBe(true);
    const failures = await db
      .select()
      .from(loginSecurityEvents)
      .where(eq(loginSecurityEvents.eventType, "login_failed"));
    expect(failures).toHaveLength(5);
    const [updated] = await db.select().from(users).where(eq(users.id, user.id));
    expect(updated?.status).toBe("locked");
  });

  it("issues no administrator session before MFA and refuses code replay", async () => {
    const user = await account("admin");
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    vi.stubEnv("ADMIN_TOTP_SECRETS", JSON.stringify({ [user.id]: secret }));
    await expect(
      login(db, { identifier: user.email!, password: "Password123!" }),
    ).rejects.toMatchObject({ code: "MFA_REQUIRED" });
    expect(await db.select().from(sessions)).toHaveLength(0);
    const totpCode = totpForStep(secret, Math.floor(Date.now() / 30_000));
    const authenticated = await login(db, {
      identifier: user.email!,
      password: "Password123!",
      totpCode,
    });
    expect(
      (await validateSession(db, authenticated.sessionId))?.session.mfaVerifiedAt,
    ).toBeTruthy();
    await expect(
      login(db, { identifier: user.email!, password: "Password123!", totpCode }),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    await db
      .update(users)
      .set({ authorizationEpoch: user.authorizationEpoch + 1 })
      .where(eq(users.id, user.id));
    const refreshed = await refreshSessionCookieAfterEpochChange(
      db,
      user.id,
      authenticated.sessionId,
    );
    expect(await validateSession(db, authenticated.sessionId)).toBeNull();
    const renewed = await validateSession(db, refreshed.value);
    expect(renewed?.session.mfaVerifiedAt).toBeTruthy();
    expect(renewed?.session.authorizationEpoch).toBe(user.authorizationEpoch + 1);
    await db.update(sessions).set({ mfaVerifiedAt: null }).where(eq(sessions.id, refreshed.value));
    expect(await validateSession(db, refreshed.value)).toBeNull();
  });

  it("persists incorrect verification guesses and exhausts a code", async () => {
    const user = await account();
    const issued = await issueContactVerification(db, {
      userId: user.id,
      idempotencyKey: "issue-one",
    });
    for (let index = 0; index < 5; index++) {
      await expect(
        verifyContact(db, { userId: user.id, otp: "bad", idempotencyKey: "same-guess" }),
      ).rejects.toMatchObject({ code: "VERIFICATION_INVALID" });
    }
    await expect(
      verifyContact(db, {
        userId: user.id,
        otp: issued.devOtpPlaintext!,
        idempotencyKey: "actual-code",
      }),
    ).rejects.toMatchObject({ code: "VERIFICATION_INVALID" });
    const [code] = await db
      .select()
      .from(contactVerificationCodes)
      .where(eq(contactVerificationCodes.id, issued.verificationId));
    expect(code?.attemptCount).toBe(5);
  });

  it("keeps student history readable at 19 and disallows new writes", async () => {
    const user = await account("student", "2007-10-16");
    const now = new Date("2026-10-16T00:00:00+08:00");
    await expect(assertSubjectAccess(db, user.id, "read", now)).resolves.toBeUndefined();
    await expect(
      db.transaction((tx) => assertSubjectAccess(tx, user.id, "write", now)),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("hides frozen goals and rejects updates even with a valid actor", async () => {
    const user = await account("student", "2015-01-01");
    const created = await createGoals(db, {
      actorId: user.id,
      content: "Read a chapter",
      dueDate: "2026-12-01",
      horizon: "short",
      idempotencyKey: "goal-before-freeze",
    });
    const now = new Date();
    await db
      .insert(deletionRequests)
      .values({
        targetType: "student_account",
        targetId: user.id,
        studentId: user.id,
        requestedBy: user.id,
        status: "frozen",
        revocableUntil: new Date(now.getTime() + 30 * 86_400_000),
        createIdempotencyKey: "freeze",
        createIdempotencyPayloadHash: "fixture",
        requestedAt: now,
        createdAt: now,
        updatedAt: now,
      });
    expect(await listGoals(db, user.id)).toEqual([]);
    await expect(
      completeGoal(db, {
        actorId: user.id,
        assignmentId: created.assignmentIds[0]!,
        idempotencyKey: "complete-frozen-goal",
      }),
    ).rejects.toMatchObject({ code: "FROZEN" });
  });

  it("purges a promoted object when finalization never stored its safe key", async () => {
    const user = await account("student", "2015-01-01");
    const mediaId = crypto.randomUUID();
    const stagingKey = `staging/${user.id}/${mediaId}`;
    const safeKey = `safe/${user.id}/${mediaId}`;
    const unreferencedAt = new Date(Date.now() - 91 * 86_400_000);
    const purgeAfter = new Date(unreferencedAt.getTime() + 90 * 86_400_000);
    await db
      .insert(mediaObjects)
      .values({
        id: mediaId,
        studentId: user.id,
        uploaderId: user.id,
        status: "revoked",
        declaredMime: "image/png",
        byteSize: 5,
        stagingObjectKey: stagingKey,
        safeObjectKey: null,
        scanResult: "clean",
        unreferencedAt,
        purgeAfter,
        createIdempotencyKey: "upload-interrupted",
        createIdempotencyPayloadHash: "fixture",
      });
    await db.insert(mediaPurgeIntents).values({ mediaId, status: "pending", purgeAfter });
    const store = createMemoryMediaStore();
    await store.putStaging(stagingKey, Buffer.from("bytes"));
    await store.promoteSafe(stagingKey, safeKey, Buffer.from("bytes"));
    await handleMediaPurgeRequestedV1(
      db,
      {
        eventId: crypto.randomUUID(),
        eventType: "family_media.purge_requested",
        eventVersion: 1,
        payload: { mediaId },
        leaseToken: "fixture",
        attemptNumber: 1,
        aggregateType: "media_object",
        aggregateId: mediaId,
      },
      store,
    );
    expect(await store.readSafe(safeKey)).toBeNull();
    const [media] = await db.select().from(mediaObjects).where(eq(mediaObjects.id, mediaId));
    expect(media?.status).toBe("purged");
  });
});
