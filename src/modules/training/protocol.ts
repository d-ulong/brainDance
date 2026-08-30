import {
  DIGIT_SPAN_TRAINING_KEY,
  REACTION_TRAINING_KEY,
  STROOP_TRAINING_KEY,
} from "@/modules/training/constants";
import {
  computeDigitSpanMetrics,
  decodeDigitSpanMetricSchema,
  getDigitSpanExpectedAttemptCount,
  validateDigitSpanEvents,
  type DigitSpanValidatedData,
} from "@/modules/training/digit-span-v1";
import {
  computeReactionMetrics,
  decodeReactionMetricSchema,
  getExpectedTrialCount as getReactionExpectedTrialCount,
  validateReactionEvents,
  type ReactionTrialRecord,
} from "@/modules/training/reaction-v1";
import {
  computeStroopMetrics,
  decodeStroopMetricSchema,
  getStroopExpectedTrialCount,
  validateStroopEvents,
  type StroopValidatedData,
} from "@/modules/training/stroop-v1";

export type TrainingEventRecord = {
  sequence: number;
  eventType: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
};

export type MetricDirection = "higher-is-better" | "lower-is-better";

export type ProtocolMetricDefinition = {
  metricKey: string;
  direction: MetricDirection;
  excludeFromProjection?: boolean;
};

export type ProtocolMetricRow = {
  metricKey: string;
  value: number;
  unit: string;
  isValid: boolean;
  calculationVersion: string;
};

export type ProtocolValidationResult =
  | { valid: true; trainingKey: string; data: ProtocolValidatedData }
  | { valid: false; reason: string };

export type ProtocolValidatedData =
  | { kind: "reaction"; trials: ReactionTrialRecord[] }
  | { kind: "stroop"; data: StroopValidatedData }
  | { kind: "digit-span"; data: DigitSpanValidatedData };

export type ComputedProtocolMetrics = {
  calculationVersion: string;
  rows: ProtocolMetricRow[];
  rejectReason?: string;
};

type TrainingProtocolHandler = {
  trainingKey: string;
  decodeMetricSchema: (raw: Record<string, unknown>) => Record<string, unknown> | null;
  getExpectedSessionCount: (schema: Record<string, unknown>) => number;
  getMetricDefinitions: () => ProtocolMetricDefinition[];
  validateEvents: (
    events: TrainingEventRecord[],
    schema: Record<string, unknown>,
  ) => ProtocolValidationResult;
  computeMetrics: (
    data: ProtocolValidatedData,
    schema: Record<string, unknown>,
  ) => ComputedProtocolMetrics;
};

const reactionHandler: TrainingProtocolHandler = {
  trainingKey: REACTION_TRAINING_KEY,
  decodeMetricSchema: decodeReactionMetricSchema,
  getExpectedSessionCount: getReactionExpectedTrialCount,
  getMetricDefinitions: () => [
    { metricKey: "accuracy", direction: "higher-is-better" },
    { metricKey: "median_reaction_ms", direction: "lower-is-better" },
    { metricKey: "valid_reaction_count", direction: "higher-is-better" },
    { metricKey: "total_trial_count", direction: "higher-is-better", excludeFromProjection: true },
  ],
  validateEvents(events, schema) {
    const expectedTrialCount = getReactionExpectedTrialCount(schema);
    const result = validateReactionEvents(events, expectedTrialCount);
    if (!result.valid) {
      return result;
    }
    return {
      valid: true,
      trainingKey: REACTION_TRAINING_KEY,
      data: { kind: "reaction", trials: result.trials },
    };
  },
  computeMetrics(data, _schema) {
    if (data.kind !== "reaction") {
      return { calculationVersion: "reaction-v1", rows: [], rejectReason: "Invalid protocol data" };
    }
    const metrics = computeReactionMetrics(data.trials);
    const rows: ProtocolMetricRow[] = [
      {
        metricKey: "accuracy",
        value: metrics.accuracy,
        unit: "ratio",
        isValid: true,
        calculationVersion: metrics.calculationVersion,
      },
      {
        metricKey: "valid_reaction_count",
        value: metrics.validReactionCount,
        unit: "count",
        isValid: true,
        calculationVersion: metrics.calculationVersion,
      },
      {
        metricKey: "total_trial_count",
        value: metrics.totalTrialCount,
        unit: "count",
        isValid: true,
        calculationVersion: metrics.calculationVersion,
      },
    ];
    if (metrics.medianReactionMs !== null) {
      rows.push({
        metricKey: "median_reaction_ms",
        value: metrics.medianReactionMs,
        unit: "ms",
        isValid: true,
        calculationVersion: metrics.calculationVersion,
      });
    }
    return { calculationVersion: metrics.calculationVersion, rows };
  },
};

const stroopHandler: TrainingProtocolHandler = {
  trainingKey: STROOP_TRAINING_KEY,
  decodeMetricSchema: decodeStroopMetricSchema,
  getExpectedSessionCount: getStroopExpectedTrialCount,
  getMetricDefinitions: () => [
    { metricKey: "congruent_accuracy", direction: "higher-is-better" },
    { metricKey: "incongruent_accuracy", direction: "higher-is-better" },
    { metricKey: "congruent_median_reaction_ms", direction: "lower-is-better" },
    { metricKey: "incongruent_median_reaction_ms", direction: "lower-is-better" },
    { metricKey: "interference_delta", direction: "lower-is-better" },
    { metricKey: "valid_trial_count", direction: "higher-is-better" },
    { metricKey: "total_trial_count", direction: "higher-is-better", excludeFromProjection: true },
  ],
  validateEvents(events, schema) {
    const result = validateStroopEvents(events, schema);
    if (!result.valid) {
      return result;
    }
    return {
      valid: true,
      trainingKey: STROOP_TRAINING_KEY,
      data: { kind: "stroop", data: result.data },
    };
  },
  computeMetrics(data, schema) {
    if (data.kind !== "stroop") {
      return { calculationVersion: "stroop-v1", rows: [], rejectReason: "Invalid protocol data" };
    }
    const metrics = computeStroopMetrics(data.data, schema);
    if (metrics.rejectReason) {
      return {
        calculationVersion: metrics.calculationVersion,
        rows: [],
        rejectReason: metrics.rejectReason,
      };
    }
    return { calculationVersion: metrics.calculationVersion, rows: metrics.rows };
  },
};

const digitSpanHandler: TrainingProtocolHandler = {
  trainingKey: DIGIT_SPAN_TRAINING_KEY,
  decodeMetricSchema: decodeDigitSpanMetricSchema,
  getExpectedSessionCount: getDigitSpanExpectedAttemptCount,
  getMetricDefinitions: () => [
    { metricKey: "forward_max_span", direction: "higher-is-better" },
    { metricKey: "backward_max_span", direction: "higher-is-better" },
    {
      metricKey: "forward_attempt_count",
      direction: "higher-is-better",
      excludeFromProjection: true,
    },
    {
      metricKey: "backward_attempt_count",
      direction: "higher-is-better",
      excludeFromProjection: true,
    },
  ],
  validateEvents(events, schema) {
    const result = validateDigitSpanEvents(events, schema);
    if (!result.valid) {
      return result;
    }
    return {
      valid: true,
      trainingKey: DIGIT_SPAN_TRAINING_KEY,
      data: { kind: "digit-span", data: result.data },
    };
  },
  computeMetrics(data, _schema) {
    if (data.kind !== "digit-span") {
      return {
        calculationVersion: "digit-span-v1",
        rows: [],
        rejectReason: "Invalid protocol data",
      };
    }
    const metrics = computeDigitSpanMetrics(data.data);
    return { calculationVersion: metrics.calculationVersion, rows: metrics.rows };
  },
};

const PROTOCOLS = new Map<string, TrainingProtocolHandler>([
  [REACTION_TRAINING_KEY, reactionHandler],
  [STROOP_TRAINING_KEY, stroopHandler],
  [DIGIT_SPAN_TRAINING_KEY, digitSpanHandler],
]);

export function getTrainingProtocol(trainingKey: string): TrainingProtocolHandler | null {
  return PROTOCOLS.get(trainingKey) ?? null;
}

export function decodeMetricSchema(
  trainingKey: string,
  raw: Record<string, unknown>,
): Record<string, unknown> | null {
  const protocol = getTrainingProtocol(trainingKey);
  if (!protocol) {
    return null;
  }
  return protocol.decodeMetricSchema(raw);
}

export function getExpectedSessionCount(
  trainingKey: string,
  schema: Record<string, unknown>,
): number {
  const protocol = getTrainingProtocol(trainingKey);
  if (!protocol) {
    return 0;
  }
  return protocol.getExpectedSessionCount(schema);
}

export function getMetricDefinitions(trainingKey: string): ProtocolMetricDefinition[] {
  return getTrainingProtocol(trainingKey)?.getMetricDefinitions() ?? [];
}

export function validateTrainingEvents(
  trainingKey: string,
  events: TrainingEventRecord[],
  schema: Record<string, unknown>,
): ProtocolValidationResult {
  const protocol = getTrainingProtocol(trainingKey);
  if (!protocol) {
    return { valid: false, reason: `Unknown training key: ${trainingKey}` };
  }
  return protocol.validateEvents(events, schema);
}

export function computeTrainingMetrics(
  trainingKey: string,
  data: ProtocolValidatedData,
  schema: Record<string, unknown>,
): ComputedProtocolMetrics {
  const protocol = getTrainingProtocol(trainingKey);
  if (!protocol) {
    return {
      calculationVersion: "unknown",
      rows: [],
      rejectReason: `Unknown training key: ${trainingKey}`,
    };
  }
  return protocol.computeMetrics(data, schema);
}

export function metricRowsToDbValues(
  sessionId: string,
  rows: ProtocolMetricRow[],
): Array<{
  sessionId: string;
  metricKey: string;
  value: string;
  unit: string;
  isValid: number;
  calculationVersion: string;
}> {
  return rows.map((row) => ({
    sessionId,
    metricKey: row.metricKey,
    value: row.value.toFixed(6),
    unit: row.unit,
    isValid: row.isValid ? 1 : 0,
    calculationVersion: row.calculationVersion,
  }));
}
