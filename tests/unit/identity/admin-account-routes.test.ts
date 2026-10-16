import { beforeEach, describe, expect, it, vi } from "vitest";
import { IdentityError } from "@/modules/identity/errors";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), list: vi.fn(), reset: vi.fn() }));
vi.mock("@/lib/auth-request", () => ({ requireAdminSession: mocks.auth }));
vi.mock("@/modules/identity/admin-accounts.service", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/modules/identity/admin-accounts.service")>();
  return { ...original, listAccounts: mocks.list, resetAccountPassword: mocks.reset };
});
import { GET } from "@/app/api/admin/accounts/route";
import { POST } from "@/app/api/admin/accounts/[userId]/reset-password/route";
const id = "12345678-1234-4234-8234-123456789abc";
const context = { params: Promise.resolve({ userId: id }) };
const request = (
  body: unknown = { expectedAuthorizationEpoch: 0, idempotencyKey: "reset-request" },
) =>
  new Request("http://localhost/api/admin/accounts/" + id + "/reset-password", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
describe("account management HTTP contracts", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.auth.mockResolvedValue({ db: {}, dbUser: { id: "actor" }, session: { id: "session" } });
    mocks.list.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    mocks.reset.mockResolvedValue({
      userId: id,
      mustChangePassword: true,
      authorizationEpoch: 1,
      idempotentReplay: true,
    });
  });
  it.each(["UNAUTHORIZED", "FORBIDDEN", "MFA_REQUIRED", "PASSWORD_CHANGE_REQUIRED"] as const)(
    "denies %s before calling services",
    async (code) => {
      mocks.auth.mockRejectedValue(new IdentityError(code, "denied"));
      const list = await GET(new Request("http://localhost/api/admin/accounts"));
      const reset = await POST(request(), context);
      expect(list.status).toBe(code === "UNAUTHORIZED" ? 401 : 403);
      expect(reset.status).toBe(list.status);
      expect(mocks.list).not.toHaveBeenCalled();
      expect(mocks.reset).not.toHaveBeenCalled();
    },
  );
  it("validates bounded pagination and reset versions at the route boundary", async () => {
    expect(
      (await GET(new Request("http://localhost/api/admin/accounts?pageSize=100000"))).status,
    ).toBe(400);
    expect(
      (
        await POST(
          request({ expectedAuthorizationEpoch: -1, idempotencyKey: "reset-request" }),
          context,
        )
      ).status,
    ).toBe(400);
    expect((await POST(request(), { params: Promise.resolve({ userId: "bad" }) })).status).toBe(
      400,
    );
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.reset).not.toHaveBeenCalled();
  });
  it("does not cache account or credential responses, replay excludes plaintext", async () => {
    const listed = await GET(new Request("http://localhost/api/admin/accounts"));
    const replay = await POST(request(), context);
    expect(listed.headers.get("cache-control")).toBe("no-store");
    expect(replay.headers.get("cache-control")).toBe("no-store");
    expect(await replay.json()).not.toHaveProperty("temporaryPassword");
  });
  it.each(["STATE_CONFLICT", "IDEMPOTENCY_CONFLICT"] as const)("maps %s to 409", async (code) => {
    mocks.reset.mockRejectedValue(new IdentityError(code, "conflict"));
    expect((await POST(request(), context)).status).toBe(409);
  });
});
