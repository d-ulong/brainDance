import {
  DEFAULT_REACTION_TRIAL_COUNT,
  REACTION_CALCULATION_VERSION,
  REACTION_MAX_VALID_MS,
  REACTION_MIN_VALID_MS,
} from "@/modules/training/constants";

export type ReactionTrialRecord = {
  trialIndex: number;
  reactionMs: number;
  correct: boolean;
};

export type ReactionEventRecord = {
  sequence: number;
  eventType: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
};

export type ReactionValidationResult =
  | {
      valid: true;
      trials: ReactionTrialRecord[];
      expectedTrialCount: number;
    }
  | {
      valid: false;
      reason: string;
    };

export type ReactionMetrics = {
  medianReactionMs: number | null;
  accuracy: number;
  validReactionCount: number;
  totalTrialCount: number;
  calculationVersion: typeof REACTION_CALCULATION_VERSION;
};

export function getExpectedTrialCount(metricSchema: Record<string, unknown>): number {
  const trialCount = metricSchema.trialCount;
  if (typeof trialCount === "number" && trialCount > 0) {
    return trialCount;
  }
  return DEFAULT_REACTION_TRIAL_COUNT;
}

export function validateReactionEvents(
  events: ReactionEventRecord[],
  expectedTrialCount: number,
): ReactionValidationResult {
  const stimuli = new Map<number, Date>();
  const trials: ReactionTrialRecord[] = [];

  for (const event of events) {
    if (event.eventType === "trial.stimulus") {
      const trialIndex = readTrialIndex(event.payload);
      if (trialIndex === null || stimuli.has(trialIndex)) {
        return { valid: false, reason: "Duplicate or invalid stimulus event" };
      }
      stimuli.set(trialIndex, event.occurredAt);
      continue;
    }

    if (event.eventType === "trial.response") {
      const trialIndex = readTrialIndex(event.payload);
      const correct = event.payload.correct;
      if (trialIndex === null || typeof correct !== "boolean") {
        return { valid: false, reason: "Invalid response payload" };
      }

      const stimulusAt = stimuli.get(trialIndex);
      if (!stimulusAt) {
        return { valid: false, reason: "Response without matching stimulus" };
      }

      const reactionMs = event.occurredAt.getTime() - stimulusAt.getTime();
      trials.push({ trialIndex, reactionMs, correct });
    }
  }

  if (trials.length !== expectedTrialCount) {
    return {
      valid: false,
      reason: `Expected ${expectedTrialCount} trials, got ${trials.length}`,
    };
  }

  const indices = trials.map((t) => t.trialIndex).sort((a, b) => a - b);
  for (let i = 0; i < expectedTrialCount; i += 1) {
    if (indices[i] !== i) {
      return { valid: false, reason: "Missing or duplicate trial indices" };
    }
  }

  return { valid: true, trials, expectedTrialCount };
}

export function computeReactionMetrics(trials: ReactionTrialRecord[]): ReactionMetrics {
  const totalTrialCount = trials.length;
  const correctTrials = trials.filter((t) => t.correct);
  const accuracy = totalTrialCount === 0 ? 0 : correctTrials.length / totalTrialCount;

  const validReactionTimes = correctTrials
    .map((t) => t.reactionMs)
    .filter((ms) => ms >= REACTION_MIN_VALID_MS && ms <= REACTION_MAX_VALID_MS)
    .sort((a, b) => a - b);

  const medianReactionMs =
    validReactionTimes.length === 0 ? null : median(validReactionTimes);

  return {
    medianReactionMs,
    accuracy,
    validReactionCount: validReactionTimes.length,
    totalTrialCount,
    calculationVersion: REACTION_CALCULATION_VERSION,
  };
}

function readTrialIndex(payload: Record<string, unknown>): number | null {
  const trialIndex = payload.trialIndex;
  if (typeof trialIndex !== "number" || !Number.isInteger(trialIndex) || trialIndex < 0) {
    return null;
  }
  return trialIndex;
}

function median(values: number[]): number {
  const mid = Math.floor(values.length / 2);
  if (values.length % 2 === 1) {
    return values[mid]!;
  }
  return (values[mid - 1]! + values[mid]!) / 2;
}
