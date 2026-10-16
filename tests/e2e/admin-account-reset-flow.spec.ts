import { randomUUID } from "node:crypto";
import { test, expect, type APIRequestContext } from "@playwright/test";
import { users } from "@/db/schema";
import { hashPassword } from "@/lib/crypto";
import { totpForStep } from "@/modules/identity/totp";
import { closeTestDb, getTestDb } from "../helpers/db";
import {
  E2E_RESET_ACTOR_ID,
  E2E_ADMIN_TOTP_SECRET,
  E2E_RESET_ADMIN_ID,
} from "../helpers/e2e-auth-config";

const originalPassword = "Before1Pass";
const newPassword = "After2Pass";
const runId = randomUUID().slice(0, 8);
const actorAccount = `reset-actor-${runId}@test.local`;
const targets = ["student", "parent", "admin"].map((role) => ({
  userId: role === "admin" ? E2E_RESET_ADMIN_ID : randomUUID(),
  account: `reset-${role}-${runId}@test.local`,
  role: role as "student" | "parent" | "admin",
}));

async function login(
  request: APIRequestContext,
  identifier: string,
  password: string,
  step?: number,
) {
  const response = await request.post("/api/auth/login", {
    data: {
      identifier,
      password,
      ...(step === undefined ? {} : { totpCode: totpForStep(E2E_ADMIN_TOTP_SECRET, step) }),
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

test.beforeAll(async () => {
  // This guard refuses all real pilot/developer database names, before any write.
  const db = getTestDb();
  const passwordHash = await hashPassword(originalPassword);
  for (const item of [
    { userId: E2E_RESET_ACTOR_ID, account: actorAccount, role: "admin" as const },
    ...targets,
  ]) {
    const value = {
      role: item.role,
      email: item.account,
      displayName: `Reset ${item.role}`,
      passwordHash,
      status: item.role === "parent" ? ("pending_verification" as const) : ("active" as const),
      contactVerifiedAt: item.role === "parent" ? null : new Date(),
      birthDate: item.role === "student" ? "2012-01-01" : null,
      mustChangePassword: false,
      authorizationEpoch: 0,
      adminTotpLastStep: null,
      lockedUntil: null,
    };
    await db
      .insert(users)
      .values({ id: item.userId, ...value })
      .onConflictDoUpdate({ target: users.id, set: value });
  }
});
test.afterAll(async () => {
  await closeTestDb();
});

test("real reset and forced self-change works for students, unverified parents and other MFA admins", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(180_000);
  const actor = await browser.newContext({ baseURL });
  try {
    await login(actor.request, actorAccount, originalPassword, Math.floor(Date.now() / 30_000) - 1);
    for (const target of targets) {
      const context = await browser.newContext({ baseURL });
      try {
        await login(
          context.request,
          target.account,
          originalPassword,
          target.role === "admin" ? Math.floor(Date.now() / 30_000) - 1 : undefined,
        );
        const key = randomUUID();
        const url = `/api/admin/accounts/${target.userId}/reset-password`;
        const data = { idempotencyKey: key, expectedAuthorizationEpoch: 0 };
        const response = await actor.request.post(url, { data });
        expect(response.ok(), await response.text()).toBeTruthy();
        expect(response.headers()["cache-control"]).toContain("no-store");
        const reset = await response.json();
        expect(reset.temporaryPassword).toMatch(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{6,12}$/);
        const replayResponse = await actor.request.post(url, { data });
        expect(replayResponse.ok()).toBe(true);
        const replay = await replayResponse.json();
        expect(replay.idempotentReplay).toBe(true);
        expect(replay.temporaryPassword).toBeUndefined();
        expect((await context.request.get("/api/auth/session")).status()).toBe(401);
        const oldLogin = await context.request.post("/api/auth/login", {
          data: { identifier: target.account, password: originalPassword },
        });
        expect(oldLogin.ok()).toBe(false);
        if (target.role === "admin") {
          const challenge = await login(context.request, target.account, reset.temporaryPassword);
          expect(challenge.mfaRequired).toBe(true);
        }
        await login(
          context.request,
          target.account,
          reset.temporaryPassword,
          target.role === "admin" ? Math.floor(Date.now() / 30_000) : undefined,
        );
        expect(
          (await (await context.request.get("/api/auth/session")).json()).mustChangePassword,
        ).toBe(true);
        const blocked = await context.request.get("/api/admin/accounts");
        expect(blocked.status()).toBe(403);
        expect((await blocked.json()).code).toBe("PASSWORD_CHANGE_REQUIRED");

        const page = await context.newPage();
        await page.goto("/account");
        await expect(page).toHaveURL(/\/change-password$/);
        await page.getByTestId("current-password").fill(reset.temporaryPassword);
        await page.getByTestId("new-password").fill(newPassword);
        await page.getByTestId("confirm-password").fill(newPassword);
        const changed = page.waitForResponse(
          (r) => r.url().endsWith("/api/auth/change-password") && r.request().method() === "POST",
        );
        await page.getByTestId("change-password-submit").click();
        expect((await changed).ok(), await (await changed).text()).toBe(true);
        await expect(page).not.toHaveURL(/\/change-password$/);
        if (target.role === "parent") await expect(page).toHaveURL(/\/verify-contact$/);
        const current = await (await context.request.get("/api/auth/session")).json();
        expect(current.mustChangePassword).toBe(false);
        if (target.role === "admin")
          expect((await context.request.get("/api/admin/accounts")).ok()).toBe(true);
        const reused = await context.request.post("/api/auth/login", {
          data: { identifier: target.account, password: reset.temporaryPassword },
        });
        expect(reused.ok()).toBe(false);
      } finally {
        await context.close();
      }
    }
  } finally {
    await actor.close();
  }
});
