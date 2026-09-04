import {
  STROOP_CALCULATION_VERSION,
  STROOP_COLORS,
  type StroopColor,
} from "@/modules/training/constants";
import type { ProtocolMetricRow, TrainingEventRecord } from "@/modules/training/protocol";
import { isFiniteEventTime, isSafePositiveInt } from "@/modules/training/protocol-schema";

export type StroopMetricSchema = {
  trialCount: number;
  congruentQuota: number;
  incongruentQuota: number;
  colors: StroopColor[];
  minValidMs: number;
  maxValidMs: number;
};

export type StroopTrialRecord = {
  trialIndex: number;
  inkColor: StroopColor;
  wordColor: StroopColor;
  congruency: "congruent" | "incongruent";
  selectedColor: StroopColor;
  correct: boolean;
  reactionMs: number;
};

export type StroopValidatedData = {
  trials: StroopTrialRecord[];
  expectedTrialCount: number;
};

const DEFAULT_STROOP_SCHEMAS: Record<string, StroopMetricSchema> = {
  "5-8": {
    trialCount: 12,
    congruentQuota: 6,
    incongruentQuota: 6,
    colors: [...STROOP_COLORS],
    minValidMs: 300,
    maxValidMs: 5000,
  },
  "9-12": {
    trialCount: 16,
    congruentQuota: 8,
    incongruentQuota: 8,
    colors: [...STROOP_COLORS],
    minValidMs: 200,
    maxValidMs: 4000,
  },
  "13-18": {
    trialCount: 20,
    congruentQuota: 10,
    incongruentQuota: 10,
    colors: [...STROOP_COLORS],
    minValidMs: 150,
    maxValidMs: 3000,
  },
  adult: {
    trialCount: 20,
    congruentQuota: 10,
    incongruentQuota: 10,
    colors: [...STROOP_COLORS],
    minValidMs: 150,
    maxValidMs: 3000,
  },
};

export function decodeStroopMetricSchema(raw: Record<string, unknown>): StroopMetricSchema | null {
  const trialCount = raw.trialCount;
  const congruentQuota = raw.congruentQuota;
  const incongruentQuota = raw.incongruentQuota;
  const colors = raw.colors;
  const minValidMs = raw.minValidMs;
  const maxValidMs = raw.maxValidMs;

  if (
    !isSafePositiveInt(trialCount) ||
    !isSafeNonNegativeInt(congruentQuota) ||
    !isSafeNonNegativeInt(incongruentQuota) ||
    typeof minValidMs !== "number" ||
    typeof maxValidMs !== "number" ||
    !Number.isFinite(minValidMs) ||
    !Number.isFinite(maxValidMs) ||
    congruentQuota + incongruentQuota !== trialCount ||
    minValidMs <= 0 ||
    maxValidMs <= minValidMs ||
    !Array.isArray(colors) ||
    colors.length < 2
  ) {
    return null;
  }

  const parsedColors: StroopColor[] = [];
  for (const color of colors) {
    if (typeof color !== "string" || !STROOP_COLORS.includes(color as StroopColor)) {
      return null;
    }
    parsedColors.push(color as StroopColor);
  }

  return {
    trialCount,
    congruentQuota,
    incongruentQuota,
    colors: parsedColors,
    minValidMs,
    maxValidMs,
  };
}

export function getStroopSchemaForAgeBand(ageBand: string): StroopMetricSchema {
  return DEFAULT_STROOP_SCHEMAS[ageBand] ?? DEFAULT_STROOP_SCHEMAS["9-12"]!;
}

export function getStroopExpectedTrialCount(schema: Record<string, unknown>): number {
  const decoded = decodeStroopMetricSchema(schema);
  return decoded?.trialCount ?? 0;
}

export function validateStroopEvents(
  events: TrainingEventRecord[],
  schemaInput: Record<string, unknown>,
): { valid: true; data: StroopValidatedData } | { valid: false; reason: string } {
  const schema = decodeStroopMetricSchema(schemaInput);
  if (!schema) {
    return { valid: false, reason: "Invalid Stroop definition schema" };
  }

  const stimuli = new Map<
    number,
    { inkColor: StroopColor; wordColor: StroopColor; occurredAt: Date }
  >();
  const trials: StroopTrialRecord[] = [];

  for (const event of events) {
    if (event.eventType === "trial.stimulus") {
      const trialIndex = readTrialIndex(event.payload);
      const inkColor = readColor(event.payload.inkColor, schema.colors);
      const wordColor = readColor(event.payload.wordColor, schema.colors);
      if (trialIndex === null || !inkColor || !wordColor || stimuli.has(trialIndex)) {
        return { valid: false, reason: "Duplicate or invalid stimulus event" };
      }
      if (!isFiniteEventTime(event.occurredAt)) {
        return { valid: false, reason: "Invalid Stroop stimulus timestamp" };
      }

      stimuli.set(trialIndex, { inkColor, wordColor, occurredAt: event.occurredAt });
      continue;
    }

    if (event.eventType === "trial.response") {
      const trialIndex = readTrialIndex(event.payload);
      const selectedColor = readColor(event.payload.selectedColor, schema.colors);
      if (trialIndex === null || !selectedColor) {
        return { valid: false, reason: "Invalid response payload" };
      }

      const stimulus = stimuli.get(trialIndex);
      if (!stimulus) {
        return { valid: false, reason: "Response without matching stimulus" };
      }
      if (!isFiniteEventTime(event.occurredAt) || !isFiniteEventTime(stimulus.occurredAt)) {
        return { valid: false, reason: "Invalid Stroop response timestamp" };
      }

      const reactionMs = event.occurredAt.getTime() - stimulus.occurredAt.getTime();
      if (reactionMs <= 0) {
        return { valid: false, reason: "Response occurred before or at stimulus time" };
      }
      const congruency = stimulus.inkColor === stimulus.wordColor ? "congruent" : "incongruent";
      trials.push({
        trialIndex,
        inkColor: stimulus.inkColor,
        wordColor: stimulus.wordColor,
        congruency,
        selectedColor,
        correct: selectedColor === stimulus.inkColor,
        reactionMs,
      });
      continue;
    }

    return { valid: false, reason: `Unknown event type: ${event.eventType}` };
  }

  if (trials.length !== schema.trialCount) {
    return {
      valid: false,
      reason: `Expected ${schema.trialCount} trials, got ${trials.length}`,
    };
  }

  const indices = trials.map((t) => t.trialIndex).sort((a, b) => a - b);
  for (let i = 0; i < schema.trialCount; i += 1) {
    if (indices[i] !== i) {
      return { valid: false, reason: "Missing or duplicate trial indices" };
    }
  }

  const congruentCount = trials.filter((t) => t.congruency === "congruent").length;
  const incongruentCount = trials.filter((t) => t.congruency === "incongruent").length;
  if (congruentCount !== schema.congruentQuota || incongruentCount !== schema.incongruentQuota) {
    return { valid: false, reason: "Congruency quota mismatch" };
  }

  return {
    valid: true,
    data: { trials, expectedTrialCount: schema.trialCount },
  };
}

export function computeStroopMetrics(
  data: StroopValidatedData,
  schemaInput: Record<string, unknown>,
): {
  calculationVersion: typeof STROOP_CALCULATION_VERSION;
  rows: ProtocolMetricRow[];
  rejectReason?: string;
} {
  const schema = decodeStroopMetricSchema(schemaInput);
  if (!schema) {
    return {
      calculationVersion: STROOP_CALCULATION_VERSION,
      rows: [],
      rejectReason: "Invalid Stroop definition schema",
    };
  }

  const congruentTrials = data.trials.filter((t) => t.congruency === "congruent");
  const incongruentTrials = data.trials.filter((t) => t.congruency === "incongruent");

  const congruentMedian = medianCorrectReactionMs(congruentTrials, schema);
  const incongruentMedian = medianCorrectReactionMs(incongruentTrials, schema);

  if (congruentMedian === null || incongruentMedian === null) {
    return {
      calculationVersion: STROOP_CALCULATION_VERSION,
      rows: [],
      rejectReason: "Missing required median reaction time for congruent or incongruent trials",
    };
  }

  const congruentAccuracy = accuracy(congruentTrials);
  const incongruentAccuracy = accuracy(incongruentTrials);
  const validTrialCount = data.trials.filter(
    (t) => t.correct && t.reactionMs >= schema.minValidMs && t.reactionMs <= schema.maxValidMs,
  ).length;

  const rows: ProtocolMetricRow[] = [
    {
      metricKey: "congruent_accuracy",
      value: congruentAccuracy,
      unit: "ratio",
      isValid: true,
      calculationVersion: STROOP_CALCULATION_VERSION,
    },
    {
      metricKey: "incongruent_accuracy",
      value: incongruentAccuracy,
      unit: "ratio",
      isValid: true,
      calculationVersion: STROOP_CALCULATION_VERSION,
    },
    {
      metricKey: "congruent_median_reaction_ms",
      value: congruentMedian,
      unit: "ms",
      isValid: true,
      calculationVersion: STROOP_CALCULATION_VERSION,
    },
    {
      metricKey: "incongruent_median_reaction_ms",
      value: incongruentMedian,
      unit: "ms",
      isValid: true,
      calculationVersion: STROOP_CALCULATION_VERSION,
    },
    {
      metricKey: "interference_delta",
      value: incongruentMedian - congruentMedian,
      unit: "ms",
      isValid: true,
      calculationVersion: STROOP_CALCULATION_VERSION,
    },
    {
      metricKey: "valid_trial_count",
      value: validTrialCount,
      unit: "count",
      isValid: true,
      calculationVersion: STROOP_CALCULATION_VERSION,
    },
    {
      metricKey: "total_trial_count",
      value: data.trials.length,
      unit: "count",
      isValid: true,
      calculationVersion: STROOP_CALCULATION_VERSION,
    },
  ];

  return { calculationVersion: STROOP_CALCULATION_VERSION, rows };
}

function readTrialIndex(payload: Record<string, unknown>): number | null {
  const trialIndex = payload.trialIndex;
  if (typeof trialIndex !== "number" || !Number.isInteger(trialIndex) || trialIndex < 0) {
    return null;
  }
  return trialIndex;
}

function readColor(value: unknown, allowed: StroopColor[]): StroopColor | null {
  if (typeof value !== "string" || !allowed.includes(value as StroopColor)) {
    return null;
  }
  return value as StroopColor;
}

function accuracy(trials: StroopTrialRecord[]): number {
  if (trials.length === 0) {
    return 0;
  }
  return trials.filter((t) => t.correct).length / trials.length;
}

function medianCorrectReactionMs(
  trials: StroopTrialRecord[],
  schema: StroopMetricSchema,
): number | null {
  const values = trials
    .filter((t) => t.correct)
    .map((t) => t.reactionMs)
    .filter((ms) => ms >= schema.minValidMs && ms <= schema.maxValidMs)
    .sort((a, b) => a - b);

  if (values.length === 0) {
    return null;
  }
  return median(values);
}

function median(values: number[]): number {
  const mid = Math.floor(values.length / 2);
  if (values.length % 2 === 1) {
    return values[mid]!;
  }
  return (values[mid - 1]! + values[mid]!) / 2;
}

function isSafeNonNegativeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export { DEFAULT_STROOP_SCHEMAS };
