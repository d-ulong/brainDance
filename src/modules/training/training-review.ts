import {
  DIGIT_SPAN_TRAINING_KEY,
  REACTION_TRAINING_KEY,
  STROOP_TRAINING_KEY,
  type StroopColor,
} from "@/modules/training/constants";
import type { DigitSpanValidatedData } from "@/modules/training/digit-span-v1";
import {
  computeTrainingMetrics,
  decodeMetricSchema,
  validateTrainingEvents,
  type ProtocolValidatedData,
  type TrainingEventRecord,
} from "@/modules/training/protocol";
import type { ReactionTrialRecord } from "@/modules/training/reaction-v1";
import type { StroopValidatedData } from "@/modules/training/stroop-v1";

const STROOP_COLOR_LABEL: Record<StroopColor, string> = {
  red: "红",
  blue: "蓝",
  green: "绿",
  yellow: "黄",
};

export type ReactionTrialReviewDto = {
  kind: "reaction";
  trialIndex: number;
  prompt: string;
  expectedAction: string;
  actualAction: string | null;
  correct: boolean;
  reactionMs: number | null;
};

export type StroopTrialReviewDto = {
  kind: "stroop";
  trialIndex: number;
  word: string;
  inkColor: string;
  expectedColor: string;
  selectedColor: string | null;
  correct: boolean;
  reactionMs: number;
};

export type DigitSpanTrialReviewDto = {
  kind: "digit-span";
  mode: "forward" | "backward";
  attemptIndex: number;
  presentedSequence: string;
  ruleDirection: string;
  expectedSequence: string;
  submittedSequence: string | null;
  correct: boolean;
};

export type TrainingTrialReviewDto =
  | ReactionTrialReviewDto
  | StroopTrialReviewDto
  | DigitSpanTrialReviewDto;

function reactionActualAction(
  events: TrainingEventRecord[],
  trialIndex: number,
): { action: string | null; reactionMs: number | null; correct: boolean } {
  const response = events.find(
    (event) =>
      event.eventType === "trial.response" &&
      event.payload.trialIndex === trialIndex,
  );
  if (!response) {
    return { action: null, reactionMs: null, correct: false };
  }
  const inputMethod = response.payload.inputMethod;
  const action =
    inputMethod === "keyboard" ? "键盘" : inputMethod === "pointer" ? "点击" : "按键";
  const early = response.payload.early === true;
  const correct = response.payload.correct === true && !early;
  const stimulus = events.find(
    (event) =>
      event.eventType === "trial.stimulus" &&
      event.payload.trialIndex === trialIndex,
  );
  const reactionMs = stimulus
    ? response.occurredAt.getTime() - stimulus.occurredAt.getTime()
    : null;
  return { action: early ? "过早按键" : action, reactionMs, correct };
}

function buildReactionReview(
  trials: ReactionTrialRecord[],
  events: TrainingEventRecord[],
): ReactionTrialReviewDto[] {
  return trials.map((trial) => {
    const actual = reactionActualAction(events, trial.trialIndex);
    return {
      kind: "reaction",
      trialIndex: trial.trialIndex,
      prompt: "绿色信号",
      expectedAction: "看到绿色后及时按键",
      actualAction: actual.action,
      correct: actual.correct,
      reactionMs: actual.reactionMs ?? trial.reactionMs,
    };
  });
}

function buildStroopReview(data: StroopValidatedData): StroopTrialReviewDto[] {
  return data.trials.map((trial) => ({
    kind: "stroop",
    trialIndex: trial.trialIndex,
    word: STROOP_COLOR_LABEL[trial.wordColor],
    inkColor: STROOP_COLOR_LABEL[trial.inkColor],
    expectedColor: STROOP_COLOR_LABEL[trial.inkColor],
    selectedColor: trial.selectedColor ? STROOP_COLOR_LABEL[trial.selectedColor] : null,
    correct: trial.correct,
    reactionMs: trial.reactionMs,
  }));
}

function expectedDigitSequence(mode: "forward" | "backward", sequence: number[]) {
  if (mode === "forward") return sequence.join("");
  return [...sequence].reverse().join("");
}

function buildDigitSpanReview(data: DigitSpanValidatedData): DigitSpanTrialReviewDto[] {
  return data.attempts.map((attempt, index) => ({
    kind: "digit-span",
    mode: attempt.mode,
    attemptIndex: index + 1,
    presentedSequence: attempt.sequence.join(""),
    ruleDirection: attempt.mode === "forward" ? "顺背" : "倒背",
    expectedSequence: expectedDigitSequence(attempt.mode, attempt.sequence),
    submittedSequence: attempt.response.length ? attempt.response.join("") : null,
    correct: attempt.correct,
  }));
}

export function buildTrainingTrialReview(
  trainingKey: string,
  events: TrainingEventRecord[],
  metricSchema: Record<string, unknown>,
): TrainingTrialReviewDto[] | null {
  const schema = decodeMetricSchema(trainingKey, metricSchema);
  if (!schema) return null;
  const validation = validateTrainingEvents(trainingKey, events, schema);
  if (!validation.valid) return null;
  const computed = computeTrainingMetrics(trainingKey, validation.data, schema);
  if (computed.rejectReason) return null;

  const data: ProtocolValidatedData = validation.data;
  if (trainingKey === REACTION_TRAINING_KEY && data.kind === "reaction") {
    return buildReactionReview(data.trials, events);
  }
  if (trainingKey === STROOP_TRAINING_KEY && data.kind === "stroop") {
    return buildStroopReview(data.data);
  }
  if (trainingKey === DIGIT_SPAN_TRAINING_KEY && data.kind === "digit-span") {
    return buildDigitSpanReview(data.data);
  }
  return null;
}
