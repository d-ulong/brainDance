import { ApiError, apiFetch, newIdempotencyKey } from "@/lib/client/api";

export type TrainingKey = "reaction" | "stroop" | "digit-span";
export type TrendWindow = "7d" | "30d" | "all";

export type StartTrainingSessionResult = {
  sessionId: string;
  trainingKey: TrainingKey;
  definitionVersion: number;
  ageBand: string;
  familyDate: string;
  expectedTrialCount: number;
  status: "active";
  idempotentReplay: boolean;
};

export type AppendTrainingEventResult = {
  sequence: number;
  occurredAt: string;
  blurAccumulatedMs: number;
  abandoned: boolean;
};

export type TrainingMetricDto = {
  metricKey: string;
  value: number;
  unit: string;
  isValid: boolean;
  calculationVersion: string;
};

export type TrainingSessionDetail = {
  sessionId: string;
  trainingKey: TrainingKey;
  definitionVersion: number;
  ageBand: string;
  familyDate: string;
  status: string;
  sessionKind: "effective" | "practice" | null;
  startedAt: string;
  finishedAt: string | null;
  blurAccumulatedMs: number;
  invalidReason: string | null;
  metrics: TrainingMetricDto[];
  eventCount: number;
};

export type TrainingSummary = {
  studentId: string;
  trainingKey: TrainingKey;
  definitionVersion: number;
  ageBand: string;
  familyDate: string;
  lastSession: {
    sessionId: string;
    status: string;
    sessionKind: "effective" | "practice" | null;
    finishedAt: string | null;
    metrics: TrainingMetricDto[];
  } | null;
  projection: Array<{
    metricKey: string;
    bestValue: number;
    lastValue: number;
  }>;
};

export type TrainingTrendPoint = {
  sessionId: string;
  familyDate: string;
  sessionKind: "effective";
  metrics: Array<{ metricKey: string; value: number; unit: string }>;
  digitSpanAttempts?: Array<{
    mode: "forward" | "backward";
    length: number;
    attemptIndex: number;
    correct: boolean;
  }>;
};

export type TrainingTrendSegment = {
  definitionVersion: number;
  ageBand: string;
  segmentReason: "initial" | "definition_version_change" | "age_band_change" | null;
  points: TrainingTrendPoint[];
};

export type TrainingTrendsResponse = {
  studentId: string;
  trainingKey: TrainingKey;
  window: TrendWindow;
  referenceFamilyDate: string;
  windowStartFamilyDate: string | null;
  hasData: boolean;
  partialCoverage: boolean;
  segments: TrainingTrendSegment[];
};

export const TRAINING_OPTIONS: Array<{
  key: TrainingKey;
  title: string;
  description: string;
  href: string;
}> = [
  {
    key: "reaction",
    title: "反应力训练",
    description: "对视觉刺激尽快作出正确响应，记录反应时间。",
    href: "/student/training/reaction",
  },
  {
    key: "stroop",
    title: "Stroop 抑制",
    description: "忽略文字含义，选择墨水颜色，练习注意力抑制。",
    href: "/student/training/stroop",
  },
  {
    key: "digit-span",
    title: "数字广度",
    description: "顺背与倒背数字序列，分别记录最长连续正确位数。",
    href: "/student/training/digit-span",
  },
];

export async function startTrainingSession(
  trainingKey: TrainingKey,
  idempotencyKey?: string,
): Promise<StartTrainingSessionResult> {
  return apiFetch<StartTrainingSessionResult>("/api/training/sessions", {
    method: "POST",
    body: JSON.stringify({
      trainingKey,
      idempotencyKey: idempotencyKey ?? newIdempotencyKey("start-training"),
    }),
  });
}

export async function appendTrainingEvent(
  sessionId: string,
  sequence: number,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<AppendTrainingEventResult> {
  return apiFetch<AppendTrainingEventResult>(`/api/training/sessions/${sessionId}/events`, {
    method: "POST",
    body: JSON.stringify({ sequence, eventType, payload }),
  });
}

export async function submitTrainingSession(
  sessionId: string,
  idempotencyKey?: string,
): Promise<{ status: string; sessionKind: string | null; metrics: TrainingMetricDto[] }> {
  return apiFetch(`/api/training/sessions/${sessionId}/submit`, {
    method: "POST",
    body: JSON.stringify({
      idempotencyKey: idempotencyKey ?? newIdempotencyKey("submit-training"),
    }),
  });
}

export async function fetchTrainingSession(sessionId: string): Promise<TrainingSessionDetail> {
  return apiFetch<TrainingSessionDetail>(`/api/training/sessions/${sessionId}`);
}

export async function fetchTrainingSummary(
  studentId: string,
  trainingKey: TrainingKey,
): Promise<TrainingSummary> {
  return apiFetch<TrainingSummary>(
    `/api/students/${studentId}/training-summary?trainingKey=${trainingKey}`,
  );
}

export async function fetchTrainingTrends(
  studentId: string,
  trainingKey: TrainingKey,
  window: TrendWindow = "7d",
): Promise<TrainingTrendsResponse> {
  return apiFetch<TrainingTrendsResponse>(
    `/api/family/students/${studentId}/training-trends?trainingKey=${trainingKey}&window=${window}`,
  );
}

export { ApiError, newIdempotencyKey };
