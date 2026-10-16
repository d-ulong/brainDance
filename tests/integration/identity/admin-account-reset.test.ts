import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditEvents, deletionRequests, outboxEvents, sessions, users } from "@/db/schema";
import * as passwordCrypto from "@/lib/crypto";
import * as outbox from "@/modules/outbox/append-outbox-event";
import { createLucia } from "@/lib/lucia";
import { listAccounts, resetAccountPassword } from "@/modules/identity/admin-accounts.service";
import { changePassword } from "@/modules/identity/change-password.service";
import { login, validateSession } from "@/modules/identity/login.service";
import { isProductPasswordValid } from "@/modules/identity/password-policy";
import { totpForStep } from "@/modules/identity/totp";
import { closeTestDb, getTestDb, migrateTestDb, resetIdentityTables } from "../../helpers/db";

const hasDb = process.env.SKIP_DB_TESTS !== "true" && Boolean(process.env.DATABASE_URL);
const initial = "Initial1Ab";
describe.skipIf(!hasDb)("administrator account reset", () => {
  const db = getTestDb();
  beforeAll(migrateTestDb);
  beforeEach(async () => {
    await resetIdentityTables(db);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });
  afterAll(closeTestDb);
  async function account(role: "admin" | "parent" | "student" = "parent") {
    const [user] = await db
      .insert(users)
      .values({
        role,
        displayName: role + " fixture",
        email: randomUUID() + "@test.local",
        passwordHash: await passwordCrypto.hashPassword(initial),
        status: "active",
        contactVerifiedAt: role === "parent" ? new Date() : null,
        birthDate: role === "student" ? "2015-01-01" : null,
      })
      .returning();
    const session = await createLucia(db).createSession(user.id, {
      authorizationEpoch: user.authorizationEpoch,
      mfaVerifiedAt: role === "admin" ? new Date() : null,
    });
    return { user, session };
  }
  async function fixture(role: "admin" | "parent" | "student" = "parent") {
    const actor = await account("admin");
    const target = await account(role);
    const command = {
      adminId: actor.user.id,
      currentSessionId: actor.session.id,
      userId: target.user.id,
      expectedAuthorizationEpoch: target.user.authorizationEpoch,
      idempotencyKey: "reset-command-1",
    };
    return { actor, target, command };
  }
  it("paginates, searches and filters only the whitelist DTO", async () => {
    const { actor, target } = await fixture();
    const result = await listAccounts(db, {
      adminId: actor.user.id,
      currentSessionId: actor.session.id,
      role: "parent",
      search: target.user.email!,
      pageSize: 1,
    });
    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(Object.keys(result.items[0]).sort()).toEqual(
      [
        "userId",
        "account",
        "displayName",
        "role",
        "status",
        "mustChangePassword",
        "authorizationEpoch",
      ].sort(),
    );
    expect(
      (
        await listAccounts(db, {
          adminId: actor.user.id,
          currentSessionId: actor.session.id,
          search: "%",
          pageSize: 1,
        })
      ).total,
    ).toBe(0);
    await expect(
      listAccounts(db, {
        adminId: actor.user.id,
        currentSessionId: actor.session.id,
        pageSize: 101,
      }),
    ).rejects.toThrow();
  });
  it.each(["parent", "student"] as const)("denies %s admin operations", async (role) => {
    const { command } = await fixture();
    const outsider = await account(role);
    const auth = { adminId: outsider.user.id, currentSessionId: outsider.session.id };
    await expect(listAccounts(db, auth)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(resetAccountPassword(db, { ...command, ...auth })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
  it("requires active current administrator MFA and no pending password change", async () => {
    const { actor, command } = await fixture();
    await db.update(sessions).set({ mfaVerifiedAt: null }).where(eq(sessions.id, actor.session.id));
    await expect(resetAccountPassword(db, command)).rejects.toMatchObject({ code: "MFA_REQUIRED" });
    await db
      .update(sessions)
      .set({ mfaVerifiedAt: new Date() })
      .where(eq(sessions.id, actor.session.id));
    await db.update(users).set({ mustChangePassword: true }).where(eq(users.id, actor.user.id));
    await expect(listAccounts(db, command)).rejects.toMatchObject({
      code: "PASSWORD_CHANGE_REQUIRED",
    });
    await db
      .update(users)
      .set({ mustChangePassword: false, status: "disabled" })
      .where(eq(users.id, actor.user.id));
    await expect(resetAccountPassword(db, command)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      resetAccountPassword(db, { ...command, currentSessionId: "missing" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
  it("rejects self reset including an upper-case UUID", async () => {
    const { actor, command } = await fixture();
    await expect(
      resetAccountPassword(db, { ...command, userId: actor.user.id.toUpperCase() }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("returns random temporary password once, revokes sessions, commits safe evidence and rejects stale keys", async () => {
    const { command, target } = await fixture();
    const result = await resetAccountPassword(db, command);
    expect(result.idempotentReplay).toBe(false);
    expect(isProductPasswordValid(result.temporaryPassword!)).toBe(true);
    const [updated] = await db.select().from(users).where(eq(users.id, target.user.id));
    expect(updated.mustChangePassword).toBe(true);
    expect(updated.authorizationEpoch).toBe(1);
    expect(
      await passwordCrypto.verifyPassword(result.temporaryPassword!, updated.passwordHash),
    ).toBe(true);
    expect(await passwordCrypto.verifyPassword(initial, updated.passwordHash)).toBe(false);
    expect(await validateSession(db, target.session.id)).toBeNull();
    const replay = await resetAccountPassword(db, command);
    expect(replay).toEqual({
      userId: target.user.id,
      mustChangePassword: true,
      authorizationEpoch: 1,
      idempotentReplay: true,
    });
    const evidence = [
      ...(await db.select().from(auditEvents)),
      ...(await db.select().from(outboxEvents)),
    ];
    expect(JSON.stringify(evidence)).not.toContain(result.temporaryPassword!);
    expect(evidence).toHaveLength(2);
    await expect(
      resetAccountPassword(db, { ...command, expectedAuthorizationEpoch: 1 }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    const other = await account();
    await expect(
      resetAccountPassword(db, { ...command, userId: other.user.id }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await expect(
      resetAccountPassword(db, { ...command, idempotencyKey: "new-reset-command" }),
    ).rejects.toMatchObject({ code: "STATE_CONFLICT" });
  });
  it("allows only one concurrent stale-version reset", async () => {
    const { command } = await fixture();
    const outcomes = await Promise.allSettled([
      resetAccountPassword(db, command),
      resetAccountPassword(db, { ...command, idempotencyKey: "competing-reset" }),
    ]);
    expect(outcomes.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.find((x) => x.status === "rejected")).toMatchObject({
      reason: { code: "STATE_CONFLICT" },
    });
    expect(await db.select().from(outboxEvents)).toHaveLength(1);
  });
  it("rolls credentials, session revocation and audit back when transactional publication fails", async () => {
    const { command, target } = await fixture();
    vi.spyOn(outbox, "appendOutboxEvent").mockRejectedValue(new Error("injected outbox failure"));
    await expect(resetAccountPassword(db, command)).rejects.toThrow("injected outbox failure");
    const [updated] = await db.select().from(users).where(eq(users.id, target.user.id));
    expect(updated.passwordHash).toBe(target.user.passwordHash);
    expect(updated.authorizationEpoch).toBe(0);
    expect(updated.mustChangePassword).toBe(false);
    expect(await validateSession(db, target.session.id)).not.toBeNull();
    expect(await db.select().from(auditEvents)).toHaveLength(0);
    expect(await db.select().from(outboxEvents)).toHaveLength(0);
  });
  it("preserves disabled target status instead of granting login", async () => {
    const { command, target } = await fixture();
    await db.update(users).set({ status: "disabled" }).where(eq(users.id, target.user.id));
    const result = await resetAccountPassword(db, command);
    await expect(
      login(db, { identifier: target.user.email!, password: result.temporaryPassword! }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("preserves a target login lock and its expiry", async () => {
    const { command, target } = await fixture();
    const lockedUntil = new Date(Date.now() + 600000);
    await db
      .update(users)
      .set({ status: "locked", lockedUntil })
      .where(eq(users.id, target.user.id));
    const result = await resetAccountPassword(db, command);
    const [updated] = await db.select().from(users).where(eq(users.id, target.user.id));
    expect(updated.status).toBe("locked");
    expect(updated.lockedUntil).toEqual(lockedUntil);
    await expect(
      login(db, { identifier: target.user.email!, password: result.temporaryPassword! }),
    ).rejects.toMatchObject({ code: "ACCOUNT_LOCKED" });
  });
  it("preserves student deletion freeze after reset", async () => {
    const { command, target } = await fixture("student");
    const [freeze] = await db
      .insert(deletionRequests)
      .values({
        targetType: "student_account",
        targetId: target.user.id,
        studentId: target.user.id,
        requestedBy: target.user.id,
        status: "frozen",
        revocableUntil: new Date(Date.now() + 86400000),
        createIdempotencyKey: "freeze-fixture",
        createIdempotencyPayloadHash: "fixture",
        requestedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    const result = await resetAccountPassword(db, command);
    await expect(
      login(db, { identifier: target.user.email!, password: result.temporaryPassword! }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const [updated] = await db
      .select()
      .from(deletionRequests)
      .where(eq(deletionRequests.id, freeze.id));
    expect(updated.status).toBe("frozen");
  });
  it.each(["student", "parent", "admin"] as const)(
    "resets %s, accepts own change and preserves original assurances",
    async (role) => {
      const { command, target } = await fixture(role);
      if (role === "parent")
        await db
          .update(users)
          .set({ contactVerifiedAt: null, status: "pending_verification" })
          .where(eq(users.id, target.user.id));
      const reset = await resetAccountPassword(db, command);
      const auth = { identifier: target.user.email!, password: reset.temporaryPassword! };
      let totpCode: string | undefined;
      if (role === "admin") {
        const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
        vi.stubEnv("ADMIN_TOTP_SECRETS", JSON.stringify({ [target.user.id]: secret }));
        await expect(login(db, auth)).rejects.toMatchObject({ code: "MFA_REQUIRED" });
        totpCode = totpForStep(secret, Math.floor(Date.now() / 30000));
      }
      const authenticated = await login(db, { ...auth, totpCode });
      const before = await validateSession(db, authenticated.sessionId);
      const change = {
        userId: target.user.id,
        currentSessionId: authenticated.sessionId,
        currentPassword: reset.temporaryPassword!,
        newPassword: "Personal2Ab",
        idempotencyKey: "personal-change",
      };
      const changed = await changePassword(db, change);
      const renewed = await validateSession(db, changed.sessionCookie.value);
      expect(renewed?.session.mfaVerifiedAt).toEqual(before?.session.mfaVerifiedAt);
      expect(renewed?.session.authorizationEpoch).toBe(2);
      expect(await validateSession(db, authenticated.sessionId)).toBeNull();
      const [updated] = await db.select().from(users).where(eq(users.id, target.user.id));
      expect(updated.mustChangePassword).toBe(false);
      expect(
        await passwordCrypto.verifyPassword(reset.temporaryPassword!, updated.passwordHash),
      ).toBe(false);
      if (role === "parent") expect(updated.contactVerifiedAt).toBeNull();
      const replay = await changePassword(db, {
        ...change,
        currentSessionId: changed.sessionCookie.value,
      });
      expect(replay.idempotentReplay).toBe(true);
      expect(replay.sessionCookie.value).toBe(changed.sessionCookie.value);
      await expect(changePassword(db, change)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      await expect(
        changePassword(db, {
          ...change,
          currentSessionId: changed.sessionCookie.value,
          newPassword: "Another3Ab",
        }),
      ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
      const second = await resetAccountPassword(db, {
        ...command,
        expectedAuthorizationEpoch: 2,
        idempotencyKey: "later-reset",
      });
      expect(second.authorizationEpoch).toBe(3);
      await expect(
        changePassword(db, { ...change, currentSessionId: changed.sessionCookie.value }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      expect(
        await db.select().from(sessions).where(eq(sessions.userId, target.user.id)),
      ).toHaveLength(0);
    },
  );

  async function waitForRowWaiter() {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const result = await db.execute(
        sql`SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%FROM users%' LIMIT 1`,
      );
      if (result.length) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("Expected concurrent credential command waiting on PostgreSQL row lock");
  }
  it.each(["reset", "change"] as const)(
    "serializes %s first against the other credential command",
    async (first) => {
      const { command, target } = await fixture();
      const originalHash = passwordCrypto.hashPassword;
      let entered!: () => void;
      let release!: () => void;
      const enteredHash = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const hashGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let gated = false;
      vi.spyOn(passwordCrypto, "hashPassword").mockImplementation(async (value) => {
        if (!gated) {
          gated = true;
          entered();
          await hashGate;
        }
        return originalHash(value);
      });
      const change = () =>
        changePassword(db, {
          userId: target.user.id,
          currentSessionId: target.session.id,
          currentPassword: initial,
          newPassword: "Personal2Ab",
          idempotencyKey: "concurrent-change",
        });
      const reset = () => resetAccountPassword(db, command);
      const firstPromise = first === "reset" ? reset() : change();
      await enteredHash;
      const secondPromise = (first === "reset" ? change() : reset()).then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
      try {
        await waitForRowWaiter();
      } finally {
        release();
      }
      await firstPromise;
      const second = await secondPromise;
      expect(second).toMatchObject({
        error: { code: first === "reset" ? "UNAUTHORIZED" : "STATE_CONFLICT" },
      });
      const [updated] = await db.select().from(users).where(eq(users.id, target.user.id));
      expect(updated.authorizationEpoch).toBe(1);
      expect(updated.mustChangePassword).toBe(first === "reset");
      expect(await db.select().from(auditEvents)).toHaveLength(1);
      expect(await db.select().from(outboxEvents)).toHaveLength(1);
    },
  );
});
