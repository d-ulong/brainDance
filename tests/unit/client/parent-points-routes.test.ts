import { beforeEach, describe, expect, it, vi } from "vitest";
import { FamilyAccessError } from "@/modules/family-access/errors";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  read: vi.fn(),
  balance: vi.fn(),
  ledger: vi.fn(),
}));
vi.mock("@/lib/auth-request", () => ({ requireAuthenticatedSession: mocks.auth }));
vi.mock("@/app/api/_lib/student-read-access", () => ({ requireStudentReadAccess: mocks.read }));
vi.mock("@/modules/settlement/ledger.service", () => ({
  queryPointsBalance: mocks.balance,
  queryPointsLedger: mocks.ledger,
}));
import { GET as balanceRoute } from "@/app/api/family/students/[studentId]/points/balance/route";
import { GET as ledgerRoute } from "@/app/api/family/students/[studentId]/points/ledger/route";

const parentId = "11111111-1111-4111-8111-111111111111";
const childId = "22222222-2222-4222-8222-222222222222";

describe("parent personal points HTTP boundary", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.auth.mockResolvedValue({ db: {}, dbUser: { id: parentId, role: "parent" } });
    mocks.balance.mockResolvedValue({ balance: 100, lastLedgerEntryId: null, updatedAt: null });
    mocks.ledger.mockResolvedValue([]);
  });
  for (const [name, route] of [
    ["balance", balanceRoute],
    ["ledger", ledgerRoute],
  ] as const) {
    it(`${name} permits self parent without inventing a family relationship`, async () => {
      const response = await route(
        new Request(`http://localhost/api/family/students/${parentId}/points/${name}`),
        { params: Promise.resolve({ studentId: parentId }) },
      );
      expect(response.status).toBe(200);
      expect(mocks.read).not.toHaveBeenCalled();
      expect(name === "balance" ? mocks.balance : mocks.ledger).toHaveBeenCalled();
    });
    it(`${name} preserves family authorization for another subject`, async () => {
      mocks.read.mockRejectedValue(new FamilyAccessError("FORBIDDEN", "No active relationship"));
      const response = await route(
        new Request(`http://localhost/api/family/students/${childId}/points/${name}`),
        { params: Promise.resolve({ studentId: childId }) },
      );
      expect(response.status).toBe(403);
      expect(mocks.read).toHaveBeenCalledWith({}, { id: parentId, role: "parent" }, childId);
      expect(mocks.balance).not.toHaveBeenCalled();
      expect(mocks.ledger).not.toHaveBeenCalled();
    });
  }
});
