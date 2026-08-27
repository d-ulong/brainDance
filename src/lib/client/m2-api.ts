import { apiFetch, newIdempotencyKey } from "@/lib/client/api";
import { toFamilyDate } from "@/modules/time-policy/to-family-date";

export type CurrentFormalPlanDto = {
  planId: string;
  versionId: string;
  title: string;
  description: string | null;
  startDate: string;
  endDate: string | null;
  status: string;
  localTime: string | null;
};

export type ScheduleItemDto = {
  id: string;
  planId: string;
  planVersionId: string;
  studentId: string;
  ownerId: string;
  familyDate: string;
  slotKey: string;
  scheduledAt: string;
  status: string;
  source: string;
  occurrenceKey: string;
  effectiveStatus: string;
};

export type PointsBalanceDto = {
  balance: number;
  lastLedgerEntryId: string | null;
  updatedAt: string | null;
};

export type PointsLedgerEntryDto = {
  id: string;
  settlementId: string;
  amount: number;
  reason: string;
  sourceType: string;
  sourceId: string;
  explanation: string;
};

const SCHEDULE_STATUS_LABELS: Record<string, string> = {
  pending: "待完成",
  completed: "已完成",
  skipped: "已跳过",
  expired: "已过期",
  cancelled: "已取消",
};

export function scheduleStatusLabel(status: string): string {
  return SCHEDULE_STATUS_LABELS[status] ?? status;
}

export function todayFamilyDate(): string {
  return toFamilyDate(new Date());
}

async function apiWriteWithIdempotency<T>(
  path: string,
  options: {
    method: "POST" | "PATCH";
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

export async function fetchCurrentFormalPlan(studentId: string) {
  return apiFetch<{ plan: CurrentFormalPlanDto | null }>(
    `/api/family/students/${studentId}/formal-plans/current`,
  );
}

export async function createFormalPlan(
  studentId: string,
  body: {
    title: string;
    description?: string | null;
    localTime: string;
    startDate: string;
    endDate?: string | null;
  },
) {
  return apiWriteWithIdempotency<{
    planId: string;
    versionId: string;
    localTime: string;
    itemsCreated: number;
    idempotentReplay: boolean;
  }>(`/api/family/students/${studentId}/formal-plans`, {
    method: "POST",
    idempotencyKeyPrefix: "create-plan",
    body,
  });
}

export async function editFormalPlan(
  planId: string,
  body: {
    title?: string | null;
    description?: string | null;
    localTime?: string | null;
    endDate?: string | null;
  },
) {
  return apiWriteWithIdempotency<{
    planId: string;
    versionId: string;
    localTime: string;
    itemsCreated: number;
    idempotentReplay: boolean;
  }>(`/api/formal-plans/${planId}`, {
    method: "PATCH",
    idempotencyKeyPrefix: "edit-plan",
    body,
  });
}

export async function deactivateFormalPlan(planId: string) {
  return apiWriteWithIdempotency<{ planId: string; status: "inactive" }>(
    `/api/formal-plans/${planId}/deactivate`,
    {
      method: "POST",
      idempotencyKeyPrefix: "deactivate-plan",
    },
  );
}

export async function maintainHorizon(studentId: string) {
  return apiWriteWithIdempotency<{
    maintainId: string;
    itemsCreated: number;
    idempotentReplay: boolean;
  }>(`/api/family/students/${studentId}/formal-plans/maintain-horizon`, {
    method: "POST",
    idempotencyKeyPrefix: "maintain-horizon",
  });
}

export async function enablePointRule(studentId: string) {
  return apiWriteWithIdempotency<{
    ruleId: string;
    ruleVersionId: string;
    idempotentReplay: boolean;
  }>(`/api/family/students/${studentId}/point-rules`, {
    method: "POST",
    idempotencyKeyPrefix: "enable-point-rule",
    body: { templateId: "schedule_system_complete_v1" },
  });
}

export async function fetchScheduleItems(studentId: string, from: string, to: string) {
  const params = new URLSearchParams({ from, to });
  return apiFetch<{ items: ScheduleItemDto[] }>(
    `/api/family/students/${studentId}/schedule-items?${params.toString()}`,
  );
}

export async function completeScheduleItem(itemId: string) {
  return apiWriteWithIdempotency<{
    scheduleItemId: string;
    eventId: string;
    factVersionId: string;
    completionKind: string;
    settlementId: string;
    ledgerEntryId: string;
    idempotentReplay: boolean;
  }>(`/api/schedule-items/${itemId}/complete`, {
    method: "POST",
    idempotencyKeyPrefix: "complete-schedule",
    body: {},
  });
}

export async function fetchPointsBalance(studentId: string) {
  return apiFetch<PointsBalanceDto>(`/api/family/students/${studentId}/points/balance`);
}

export async function fetchPointsLedger(studentId: string, limit = 10) {
  const params = new URLSearchParams({ limit: String(limit) });
  return apiFetch<{ entries: PointsLedgerEntryDto[] }>(
    `/api/family/students/${studentId}/points/ledger?${params.toString()}`,
  );
}
