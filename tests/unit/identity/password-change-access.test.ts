import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ validate: vi.fn(), row: vi.fn(), getCookie: vi.fn() }));
vi.mock("@/db", () => ({
  getDb: () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: mocks.row }) }) }),
  }),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: mocks.getCookie }) }));
vi.mock("@/lib/lucia", () => ({ createLucia: () => ({ sessionCookieName: "test-session" }) }));
vi.mock("@/modules/identity/login.service", () => ({ validateSession: mocks.validate }));
import {
  requireAdminSession,
  requireAuthenticatedSession,
  requireStudentSession,
  requireParentSession,
} from "@/lib/auth-request";

describe("centralized forced password access", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getCookie.mockReturnValue({ value: "valid" });
    mocks.validate.mockResolvedValue({
      user: { id: "user", role: "parent", authorizationEpoch: 1 },
      session: { id: "valid", authorizationEpoch: 1, mfaVerifiedAt: new Date() },
    });
  });
  it.each(["admin", "parent", "student"])(
    "denies protected %s reads and writes until own change",
    async (role) => {
      mocks.row.mockResolvedValue([
        { id: "user", role, authorizationEpoch: 1, mustChangePassword: true, status: "active" },
      ]);
      for (const guard of [
        requireAuthenticatedSession,
        requireAdminSession,
        requireStudentSession,
        requireParentSession,
      ]) {
        await expect(guard()).rejects.toMatchObject({ code: "PASSWORD_CHANGE_REQUIRED" });
      }
      await expect(
        requireAuthenticatedSession({ allowPasswordChangeRequired: true }),
      ).resolves.toHaveProperty("dbUser.role", role);
    },
  );
  it("does not exempt missing or stale sessions with the password-change flag", async () => {
    mocks.getCookie.mockReturnValue(undefined);
    await expect(
      requireAuthenticatedSession({ allowPasswordChangeRequired: true }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    mocks.getCookie.mockReturnValue({ value: "valid" });
    mocks.row.mockResolvedValue([{ id: "user", authorizationEpoch: 2 }]);
    await expect(
      requireAuthenticatedSession({ allowPasswordChangeRequired: true }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
  it.each(["disabled", "locked"])("does not exempt %s status", async (status) => {
    mocks.row.mockResolvedValue([{ id: "user", authorizationEpoch: 1, status }]);
    await expect(
      requireAuthenticatedSession({ allowPasswordChangeRequired: true }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
