import {
  getMetricDefinitions,
  type MetricDirection,
  type ProtocolMetricDefinition,
} from "@/modules/training/protocol";

export type ProjectionMetricInput = {
  metricKey: string;
  value: number;
  isValid: boolean;
};

export type ProjectionRowState = {
  metricKey: string;
  bestValue: number;
  lastValue: number;
  lastSourceSessionId: string;
  lastFamilyDate: string;
};

export function getProjectionMetricDefinitions(trainingKey: string): ProtocolMetricDefinition[] {
  return getMetricDefinitions(trainingKey).filter(
    (definition) => !definition.excludeFromProjection,
  );
}

export function filterProjectionEligibleMetrics(
  trainingKey: string,
  metrics: ProjectionMetricInput[],
): ProjectionMetricInput[] {
  const eligibleKeys = new Set(
    getProjectionMetricDefinitions(trainingKey).map((definition) => definition.metricKey),
  );
  return metrics.filter((metric) => metric.isValid && eligibleKeys.has(metric.metricKey));
}

export function computeBestValue(
  existing: number | undefined,
  newValue: number,
  direction: MetricDirection,
): number {
  if (existing === undefined) {
    return newValue;
  }
  return direction === "lower-is-better"
    ? Math.min(existing, newValue)
    : Math.max(existing, newValue);
}

export function mergeMetricIntoProjectionState(
  state: Map<string, ProjectionRowState>,
  input: {
    trainingKey: string;
    sessionId: string;
    familyDate: string;
    metrics: ProjectionMetricInput[];
  },
): void {
  const directionByKey = new Map(
    getMetricDefinitions(input.trainingKey).map((definition) => [
      definition.metricKey,
      definition.direction,
    ]),
  );

  for (const metric of filterProjectionEligibleMetrics(input.trainingKey, input.metrics)) {
    const direction = directionByKey.get(metric.metricKey);
    if (!direction) {
      continue;
    }

    const existing = state.get(metric.metricKey);
    const bestValue = computeBestValue(existing?.bestValue, metric.value, direction);

    state.set(metric.metricKey, {
      metricKey: metric.metricKey,
      bestValue,
      lastValue: metric.value,
      lastSourceSessionId: input.sessionId,
      lastFamilyDate: input.familyDate,
    });
  }
}
