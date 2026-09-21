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
  title: string;
  planTitle: string;
  priority: number;
  startedAt: string | null;
  description?: string | null;
  pointsEarned?: number | null;
  pointsRuleLabel?: string | null;
  maximumPoints?: number;
  durationMinutes?: number | null;
  taskType?: "normal" | "homework" | "exercise";
  completionStandard?: string | null;
  checklist?: Array<{ id: string; title: string; completed: boolean }>;
  pomodoro?: { state?: "running" | "paused"; pauseCount?: number; pausedSeconds?: number };
  canEditExecution?: boolean;
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
  in_progress: "进行中",
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

export async function clearSchedule(studentId: string, from: string, through: string) {
  return apiWriteWithIdempotency<{ clearedCount: number; idempotentReplay: boolean }>(
    `/api/family/students/${studentId}/schedule-items`,
    { method: "DELETE", idempotencyKeyPrefix: "clear-schedule", body: { from, through } },
  );
}

export async function completeScheduleItem(
  itemId: string,
  execution?: { startedAt?: string; completedAt?: string; durationMinutes?: number },
) {
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
    body: execution ?? {},
  });
}
export async function startPlanItem(itemId: string) {
  return apiWriteWithIdempotency<{
    factVersionId: string;
    startedAt: string;
    idempotentReplay: boolean;
  }>(`/api/schedule-items/${itemId}/start`, {
    method: "POST",
    idempotencyKeyPrefix: "start-plan-item",
    body: {},
  });
}
export async function updateTaskExecution(
  itemId: string,
  body: {
    checklist?: Array<{
      id: string;
      title: string;
      completed: boolean;
      difficulty?: string;
      durationMinutes?: number;
    }>;
    pomodoroAction?: "start" | "pause" | "resume";
  },
) {
  return apiWriteWithIdempotency(`/api/schedule-items/${itemId}/execution`, {
    method: "PATCH",
    idempotencyKeyPrefix: "schedule-task-execution",
    body,
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

export type PushLibraryEntryDto = {
  id: string;
  body: string;
  linkUrl: string | null;
  tags: string[];
  answerDisclosureDays: number | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
  deliveries: {
    studentId: string;
    pushId: string;
    status: string;
    publishedAt: string | null;
    scheduledAt: string | null;
    tags: string[];
  }[];
};
export type LinkedStudentDto = { studentId: string; displayName: string; username: string | null };
export async function fetchLinkedStudents() {
  return apiFetch<{ students: LinkedStudentDto[] }>("/api/family/students");
}
export async function fetchPushLibrary(filters?: {
  studentId?: string;
  from?: string;
  through?: string;
  tags?: string[];
  answerDisclosureDays?: number | null;
}) {
  const params = new URLSearchParams();
  if (filters?.studentId) params.set("studentId", filters.studentId);
  if (filters?.from) params.set("from", filters.from);
  if (filters?.through) params.set("through", filters.through);
  filters?.tags?.forEach((tag) => params.append("tag", tag));
  return apiFetch<{ entries: PushLibraryEntryDto[]; students: LinkedStudentDto[] }>(
    `/api/push-library?${params.toString()}`,
  );
}
export async function savePushLibraryEntry(body: {
  entryId?: string;
  revision?: number;
  body?: string;
  linkUrl?: string | null;
  tags?: string[];
  answerDisclosureDays?: number | null;
}) {
  return apiWriteWithIdempotency<{ entry: PushLibraryEntryDto }>("/api/push-library", {
    method: "POST",
    idempotencyKeyPrefix: "save-push-library",
    body,
  });
}
export async function publishPushLibraryEntry(body: {
  entryId: string;
  revision: number;
  studentIds: string[];
  publishMode: "immediate" | "scheduled";
  scheduledPublishAt?: string;
  mediaIdsByStudent?: Record<string, string[]>;
}) {
  return apiWriteWithIdempotency<{ publicationId: string; idempotentReplay: boolean }>(
    "/api/push-library",
    { method: "PATCH", idempotencyKeyPrefix: "publish-push-library", body },
  );
}
export type PlanDefinitionDto = {
  title: string;
  description?: string;
  startDate: string;
  endDate?: string | null;
  entries: {
    key: string;
    title: string;
    description?: string;
    expectedTime: string;
    latestStartTime?: string | null;
    durationMinutes?: number | null;
    taskType?: "normal" | "homework" | "exercise";
    completionStandard?: string | null;
    checklist?: Array<{ id: string; title: string }>;
    repeat: { kind: string; date?: string; weekdays?: number[]; days?: number[] };
    points: {
      onTimeWithin: number;
      onTimeOver: number;
      lateWithin: number;
      lateOver: number;
      incomplete: number;
    };
  }[];
};
export type PlanLibraryBindingDto = LinkedStudentDto & { effectiveFrom: string };
export type PlanLibraryDto = {
  id: string;
  revision: number;
  definition: PlanDefinitionDto;
  priority: number;
  createdAt: string;
  updatedAt: string;
  bindings: PlanLibraryBindingDto[];
  ownerId: string;
  ownerName?: string;
  canEdit?: boolean;
  boundToSelf?: boolean;
  generatedDatesByStudent?: Record<string, string[]>;
};
export async function fetchPlanLibrary() {
  return apiFetch<{ plans: PlanLibraryDto[] }>("/api/plan-library");
}
export async function savePlanLibrary(definition: PlanDefinitionDto, priority = 0) {
  return apiWriteWithIdempotency<{
    plan: { id: string; revision: number; definition: PlanDefinitionDto };
  }>("/api/plan-library", {
    method: "POST",
    idempotencyKeyPrefix: "save-plan-library",
    body: { definition, priority },
  });
}
export async function updatePlanLibrary(
  libraryId: string,
  revision: number,
  definition: PlanDefinitionDto,
  priority = 0,
) {
  return apiWriteWithIdempotency<{
    plan: { id: string; revision: number; definition: PlanDefinitionDto };
  }>("/api/plan-library", {
    method: "PATCH",
    idempotencyKeyPrefix: "update-plan-library",
    body: { libraryId, revision, definition, priority },
  });
}
export async function activatePlanLibrary(
  libraryId: string,
  studentId: string,
  effectiveFrom?: string,
) {
  return apiWriteWithIdempotency<{
    activationId: string;
    planId: string;
    itemsCreated: number;
    matchedOccurrences: number;
    effectiveFrom: string;
    generatedFrom: string;
    generatedThrough: string;
  }>(`/api/plan-library/${libraryId}/activate`, {
    method: "POST",
    idempotencyKeyPrefix: "activate-plan-library",
    body: { studentId, effectiveFrom },
  });
}
export async function removePlanLibraryBinding(libraryId: string, studentId: string) {
  return apiWriteWithIdempotency<{ idempotentReplay: boolean; cancelledItems?: number }>(
    `/api/plan-library/${libraryId}/bindings/${studentId}`,
    { method: "DELETE", idempotencyKeyPrefix: "remove-plan-library-binding", body: {} },
  );
}
export async function generatePlanLibraryRange(
  libraryId: string,
  studentId: string,
  from: string,
  through: string,
) {
  return apiWriteWithIdempotency<{
    activationId: string;
    itemsCreated: number;
    generatedFrom: string;
    generatedThrough: string;
    idempotentReplay: boolean;
  }>(`/api/plan-library/${libraryId}/generate`, {
    method: "POST",
    idempotencyKeyPrefix: "generate-plan-library",
    body: { studentId, from, through },
  });
}

export type GoalDto = {
  assignmentId: string;
  definitionId: string;
  subjectId: string;
  subjectName: string;
  creatorId: string;
  responsibleParentId: string | null;
  responsibleParentName: string | null;
  source: "parent" | "student";
  content: string;
  dueDate: string;
  expectedPoints: number | null;
  expectedGift: string | null;
  notes: string | null;
  horizon: "short" | "medium" | "long";
  status: "pending_approval" | "active" | "completed" | "succeeded" | "failed";
  actualPoints: number | null;
  actualGift: string | null;
  evaluationReason: string | null;
  evaluatedAt: string | null;
  completedAt: string | null;
  giftRedeemedAt: string | null;
  revision: number;
  postNotes: Array<{
    id: string;
    authorId: string;
    authorName: string;
    body: string;
    createdAt: string;
  }>;
  canApprove: boolean;
  canComplete: boolean;
  canEvaluate: boolean;
  canEdit: boolean;
  canAddNote: boolean;
  canRecordGiftRedemption: boolean;
  isPersonal: boolean;
};

export async function fetchGoals() {
  return apiFetch<{ goals: GoalDto[] }>("/api/goals");
}

export async function createGoals(body: {
  subjectIds?: string[];
  content: string;
  dueDate: string;
  expectedPoints?: number | null;
  expectedGift?: string | null;
  notes?: string | null;
  horizon: "short" | "medium" | "long";
}) {
  return apiWriteWithIdempotency<{ definitionId: string; assignmentIds: string[] }>("/api/goals", {
    method: "POST",
    idempotencyKeyPrefix: "create-goals",
    body,
  });
}

export async function updateGoal(
  assignmentId: string,
  body: {
    revision: number;
    content: string;
    dueDate: string;
    expectedPoints?: number | null;
    expectedGift?: string | null;
    notes?: string | null;
    horizon: "short" | "medium" | "long";
  },
) {
  return apiWriteWithIdempotency<{ assignmentId: string; revision: number }>(
    `/api/goals/${assignmentId}`,
    {
      method: "PATCH",
      idempotencyKeyPrefix: "update-goal",
      body,
    },
  );
}

export async function addGoalNote(assignmentId: string, body: string) {
  return apiWriteWithIdempotency<{ noteId: string; assignmentId: string }>(
    `/api/goals/${assignmentId}/notes`,
    {
      method: "POST",
      idempotencyKeyPrefix: "add-goal-note",
      body: { body },
    },
  );
}

export async function approveGoal(assignmentId: string) {
  return apiWriteWithIdempotency<{ assignmentId: string; status: string }>(
    `/api/goals/${assignmentId}/approve`,
    {
      method: "POST",
      idempotencyKeyPrefix: "approve-goal",
      body: {},
    },
  );
}

export async function completeGoal(assignmentId: string) {
  return apiWriteWithIdempotency<{ assignmentId: string; status: string; completedAt: string }>(
    `/api/goals/${assignmentId}/complete`,
    {
      method: "POST",
      idempotencyKeyPrefix: "complete-goal",
      body: {},
    },
  );
}

export async function evaluateGoal(
  assignmentId: string,
  body: {
    outcome: "succeeded" | "failed";
    actualPoints?: number | null;
    actualGift?: string | null;
    reason?: string | null;
  },
) {
  return apiWriteWithIdempotency<{
    assignmentId: string;
    status: string;
    ledgerEntryId: string | null;
  }>(`/api/goals/${assignmentId}/evaluate`, {
    method: "POST",
    idempotencyKeyPrefix: "evaluate-goal",
    body,
  });
}

export async function recordGoalGiftRedemption(assignmentId: string, redeemedAt: string) {
  return apiWriteWithIdempotency<{ assignmentId: string; giftRedeemedAt: string }>(
    `/api/goals/${assignmentId}/gift-redemption`,
    {
      method: "POST",
      idempotencyKeyPrefix: "goal-gift-redemption",
      body: { redeemedAt },
    },
  );
}

export type ManualPointAdjustmentDto = {
  id: string;
  studentId: string;
  actorParentId: string;
  actorName: string;
  kind: "penalty" | "reversal";
  amount: number;
  reason: string;
  originalAdjustmentId: string | null;
  ledgerEntryId: string;
  createdAt: string;
  canReverse: boolean;
};

export async function fetchManualPenalties(studentId: string) {
  return apiFetch<{ adjustments: ManualPointAdjustmentDto[] }>(
    `/api/family/students/${studentId}/points/penalties`,
  );
}

export async function createManualPenalty(studentId: string, points: number, reason: string) {
  return apiWriteWithIdempotency(`/api/family/students/${studentId}/points/penalties`, {
    method: "POST",
    idempotencyKeyPrefix: "manual-penalty",
    body: { points, reason },
  });
}

export async function reverseManualPenalty(
  studentId: string,
  adjustmentId: string,
  reason: string,
) {
  return apiWriteWithIdempotency(
    `/api/family/students/${studentId}/points/penalties/${adjustmentId}/reverse`,
    {
      method: "POST",
      idempotencyKeyPrefix: "reverse-manual-penalty",
      body: { reason },
    },
  );
}

export type PointsPeriodSummaryDto = {
  from: string;
  through: string;
  schedulePoints: number;
  goalRewards: number;
  manualAdjustments: number;
  netPoints: number;
  maximumSchedulePoints: number;
  entries: Array<{
    id: string;
    amount: number;
    reason: string;
    explanation: string;
    sourceType: string;
    occurredAt: string;
  }>;
};

export async function fetchPointsPeriodSummary(studentId: string, from: string, through: string) {
  const params = new URLSearchParams({ from, through });
  return apiFetch<PointsPeriodSummaryDto>(
    `/api/family/students/${studentId}/points/summary?${params.toString()}`,
  );
}
