import { apiFetch } from "@/lib/client/api";

export type AdminAccount = {
  userId: string;
  account: string;
  displayName: string;
  role: "admin" | "parent" | "student";
  status: "pending_verification" | "active" | "locked" | "disabled";
  mustChangePassword: boolean;
  authorizationEpoch: number;
};

export type AdminAccountList = {
  items: AdminAccount[];
  total: number;
  page: number;
  pageSize: number;
};
export type PasswordResetResult = {
  userId: string;
  mustChangePassword: true;
  authorizationEpoch: number;
  temporaryPassword?: string;
  idempotentReplay: boolean;
};

export function listAdminAccounts(
  input: { page: number; search: string; role: string },
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({ page: String(input.page), pageSize: "20" });
  if (input.search) query.set("search", input.search);
  if (input.role) query.set("role", input.role);
  return apiFetch<AdminAccountList>(`/api/admin/accounts?${query}`, { cache: "no-store", signal });
}

export function resetAccountPassword(target: AdminAccount, idempotencyKey: string) {
  return apiFetch<PasswordResetResult>(`/api/admin/accounts/${target.userId}/reset-password`, {
    method: "POST",
    cache: "no-store",
    body: JSON.stringify({ idempotencyKey, expectedAuthorizationEpoch: target.authorizationEpoch }),
  });
}
