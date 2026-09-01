import { apiFetch, newIdempotencyKey } from "@/lib/client/api";

export type CatalogItemDto = {
  id: string;
  studentId: string;
  creatorParentId: string;
  title: string;
  description: string | null;
  cost: number;
  monthlyLimit: number | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type RedemptionDto = {
  id: string;
  studentId: string;
  catalogItemId: string;
  costSnapshot: number;
  requestMonth: string;
  status: string;
  requestedAt: string;
  confirmedAt: string | null;
  confirmedBy: string | null;
  rejectionReason: string | null;
  ledgerEntryId: string | null;
};

export type ExportJobDto = {
  id: string;
  requesterId: string;
  studentId: string;
  status: string;
  readyAt: string | null;
  expiresAt: string | null;
  consumedAt: string | null;
  createdAt: string;
};

export type ExportJobStatusDto = {
  id: string;
  status: string;
  readyAt: string | null;
  expiresAt: string | null;
  consumedAt: string | null;
};

export type DeletionRequestDto = {
  id: string;
  targetType: string;
  targetId: string;
  studentId: string;
  requestedBy: string;
  status: string;
  revocableUntil: string;
  studentConfirmedAt: string | null;
  requestedAt: string;
  executedAt: string | null;
};

const REDEMPTION_STATUS_LABELS: Record<string, string> = {
  pending: "待审批",
  approved: "已批准",
  rejected: "已拒绝",
  cancelled: "已撤销",
};

const EXPORT_STATUS_LABELS: Record<string, string> = {
  pending: "排队中",
  processing: "生成中",
  ready: "可下载",
  failed: "失败",
  expired: "已过期",
  revoked: "已撤销",
};

const DELETION_STATUS_LABELS: Record<string, string> = {
  requested: "已请求",
  frozen: "已冻结",
  cancelled: "已撤销",
  executed: "已执行",
};

export function redemptionStatusLabel(status: string): string {
  return REDEMPTION_STATUS_LABELS[status] ?? status;
}

export function exportStatusLabel(status: string): string {
  return EXPORT_STATUS_LABELS[status] ?? status;
}

export function deletionStatusLabel(status: string): string {
  return DELETION_STATUS_LABELS[status] ?? status;
}

async function apiWriteWithIdempotency<T>(
  path: string,
  options: {
    method: "POST" | "PATCH" | "DELETE";
    body?: unknown;
    idempotencyKeyPrefix: string;
  },
): Promise<T> {
  return apiFetch<T>(path, {
    method: options.method,
    headers: { "Idempotency-Key": newIdempotencyKey(options.idempotencyKeyPrefix) },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
}

export async function fetchRedemptionCatalog(studentId: string, activeOnly = false) {
  const params = activeOnly ? "?activeOnly=true" : "";
  return apiFetch<{ items: CatalogItemDto[] }>(
    `/api/family/students/${studentId}/redemption-catalog${params}`,
  );
}

export async function createCatalogItem(
  studentId: string,
  body: {
    title: string;
    description?: string | null;
    cost: number;
    monthlyLimit?: number | null;
  },
) {
  return apiWriteWithIdempotency<{ item: CatalogItemDto; idempotentReplay: boolean }>(
    `/api/family/students/${studentId}/redemption-catalog`,
    { method: "POST", idempotencyKeyPrefix: "create-catalog", body },
  );
}

export async function updateCatalogItem(
  studentId: string,
  itemId: string,
  body: {
    title?: string;
    description?: string | null;
    cost?: number;
    monthlyLimit?: number | null;
    active?: boolean;
  },
) {
  return apiWriteWithIdempotency<{ item: CatalogItemDto; idempotentReplay: boolean }>(
    `/api/family/students/${studentId}/redemption-catalog/${itemId}`,
    { method: "PATCH", idempotencyKeyPrefix: "update-catalog", body },
  );
}

export async function fetchRedemptions(studentId: string) {
  return apiFetch<{ redemptions: RedemptionDto[] }>(
    `/api/family/students/${studentId}/redemptions`,
  );
}

export async function createRedemption(studentId: string, catalogItemId: string) {
  return apiWriteWithIdempotency<{ redemption: RedemptionDto; idempotentReplay: boolean }>(
    `/api/family/students/${studentId}/redemptions`,
    { method: "POST", idempotencyKeyPrefix: "create-redemption", body: { catalogItemId } },
  );
}

export async function cancelRedemption(studentId: string, redemptionId: string) {
  return apiWriteWithIdempotency<{ redemption: RedemptionDto; idempotentReplay: boolean }>(
    `/api/family/students/${studentId}/redemptions/${redemptionId}/cancel`,
    { method: "POST", idempotencyKeyPrefix: "cancel-redemption" },
  );
}

export async function approveRedemption(studentId: string, redemptionId: string) {
  return apiWriteWithIdempotency<{ redemption: RedemptionDto; idempotentReplay: boolean }>(
    `/api/family/students/${studentId}/redemptions/${redemptionId}/approve`,
    { method: "POST", idempotencyKeyPrefix: "approve-redemption" },
  );
}

export async function rejectRedemption(studentId: string, redemptionId: string, reason: string) {
  return apiWriteWithIdempotency<{ redemption: RedemptionDto; idempotentReplay: boolean }>(
    `/api/family/students/${studentId}/redemptions/${redemptionId}/reject`,
    { method: "POST", idempotencyKeyPrefix: "reject-redemption", body: { reason } },
  );
}

export async function fetchExportJobs() {
  return apiFetch<{ jobs: ExportJobDto[] }>("/api/export-jobs");
}

export async function createExportJob(studentId: string) {
  return apiWriteWithIdempotency<{ jobId: string; status: string; idempotentReplay: boolean }>(
    "/api/export-jobs",
    { method: "POST", idempotencyKeyPrefix: "create-export", body: { studentId } },
  );
}

export async function processExportJob(jobId: string) {
  return apiWriteWithIdempotency<{
    jobId: string;
    status: string;
    downloadTokenPlaintext?: string;
    idempotentReplay: boolean;
  }>(`/api/export-jobs/${jobId}/process`, {
    method: "POST",
    idempotencyKeyPrefix: "process-export",
  });
}

export async function fetchExportJobStatus(jobId: string) {
  return apiFetch<ExportJobStatusDto>(`/api/export-jobs/${jobId}/download`);
}

export async function downloadExportArtifact(jobId: string, token: string): Promise<ArrayBuffer> {
  const response = await fetch(`/api/export-jobs/${jobId}/download`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string | { code?: string; message: string };
    };
    const message =
      typeof body.error === "object" && body.error !== null
        ? body.error.message
        : (body.error ?? `Download failed with status ${response.status}`);
    throw new Error(message);
  }

  return response.arrayBuffer();
}

export async function createDeletionRequest(
  targetType: "student_account" | "daily_reflection",
  targetId: string,
) {
  return apiWriteWithIdempotency<{
    requestId: string;
    status: string;
    revocableUntil: string;
    idempotentReplay: boolean;
  }>("/api/deletion-requests", {
    method: "POST",
    idempotencyKeyPrefix: "create-deletion",
    body: { targetType, targetId },
  });
}

export async function fetchDeletionRequest(requestId: string) {
  return apiFetch<{ request: DeletionRequestDto }>(`/api/deletion-requests/${requestId}`);
}

export async function cancelDeletionRequest(requestId: string) {
  return apiWriteWithIdempotency<{ requestId: string; status: string; idempotentReplay: boolean }>(
    `/api/deletion-requests/${requestId}`,
    { method: "DELETE", idempotencyKeyPrefix: "cancel-deletion" },
  );
}

export async function confirmDeletionRequest(requestId: string) {
  return apiWriteWithIdempotency<{
    requestId: string;
    studentConfirmedAt: string;
    idempotentReplay: boolean;
  }>(`/api/deletion-requests/${requestId}/confirm`, {
    method: "POST",
    idempotencyKeyPrefix: "confirm-deletion",
  });
}

export function exportTokenStorageKey(jobId: string): string {
  return `m6-export-token:${jobId}`;
}

export function readStoredExportToken(jobId: string): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(exportTokenStorageKey(jobId));
}

export function storeExportToken(jobId: string, token: string): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(exportTokenStorageKey(jobId), token);
}
