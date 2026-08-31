import type { TrainingKey } from "@/lib/client/training-api";

const METRIC_LABELS: Record<string, string> = {
  median_reaction_ms: "中位反应时",
  accuracy: "准确率",
  valid_trial_count: "有效试次数",
  total_trial_count: "总试次数",
  congruent_accuracy: "一致试次准确率",
  incongruent_accuracy: "不一致试次准确率",
  congruent_median_reaction_ms: "一致试次中位反应时",
  incongruent_median_reaction_ms: "不一致试次中位反应时",
  interference_delta: "干扰差值",
  forward_max_span: "顺背最长连续正确位数",
  backward_max_span: "倒背最长连续正确位数",
  forward_attempt_count: "顺背尝试次数",
  backward_attempt_count: "倒背尝试次数",
};

const TRAINING_KEY_LABELS: Record<TrainingKey, string> = {
  reaction: "反应力",
  stroop: "Stroop 抑制",
  "digit-span": "数字广度",
};

const SESSION_KIND_LABELS: Record<string, string> = {
  effective: "有效训练",
  practice: "练习",
};

const AGE_BAND_LABELS: Record<string, string> = {
  "5-8": "5–8 岁",
  "9-12": "9–12 岁",
  "13-18": "13–18 岁",
};

const SEGMENT_REASON_LABELS: Record<string, string> = {
  initial: "起始段",
  definition_version_change: "训练定义版本变更",
  age_band_change: "年龄档变更",
};

export function formatMetricLabel(metricKey: string): string {
  return METRIC_LABELS[metricKey] ?? metricKey;
}

export function formatTrainingKeyLabel(trainingKey: TrainingKey): string {
  return TRAINING_KEY_LABELS[trainingKey] ?? trainingKey;
}

export function formatSessionKind(sessionKind: string | null): string {
  if (!sessionKind) return "—";
  return SESSION_KIND_LABELS[sessionKind] ?? sessionKind;
}

export function formatAgeBand(ageBand: string): string {
  return AGE_BAND_LABELS[ageBand] ?? ageBand;
}

export function formatSegmentReason(reason: string | null): string {
  if (!reason) return "—";
  return SEGMENT_REASON_LABELS[reason] ?? reason;
}

export function formatMetricValue(value: number, unit: string | null): string {
  if (unit === "ratio") {
    return `${Math.round(value * 100)}%`;
  }
  if (unit === "ms") {
    return `${Math.round(value)} ms`;
  }
  if (unit === "digits" || unit === "count") {
    return String(Math.round(value));
  }
  return unit ? `${value} ${unit}` : String(value);
}
