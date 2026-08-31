import { STROOP_COLORS, type StroopColor } from "@/modules/training/constants";
import { getStroopSchemaForAgeBand } from "@/modules/training/stroop-v1";

export type StroopTrialPlan = {
  trialIndex: number;
  inkColor: StroopColor;
  wordColor: StroopColor;
  congruent: boolean;
};

export function buildStroopTrialPlan(ageBand: string): StroopTrialPlan[] {
  const schema = getStroopSchemaForAgeBand(ageBand);
  const trials: StroopTrialPlan[] = [];

  for (let trialIndex = 0; trialIndex < schema.trialCount; trialIndex += 1) {
    const congruent = trialIndex < schema.congruentQuota;
    const inkColor = STROOP_COLORS[trialIndex % STROOP_COLORS.length]!;
    const wordColor = congruent
      ? inkColor
      : STROOP_COLORS[(trialIndex + 1) % STROOP_COLORS.length]!;

    trials.push({ trialIndex, inkColor, wordColor, congruent });
  }

  return trials;
}

export const STROOP_COLOR_LABELS: Record<StroopColor, string> = {
  red: "红色",
  blue: "蓝色",
  green: "绿色",
  yellow: "黄色",
};

export const STROOP_COLOR_CLASSES: Record<StroopColor, string> = {
  red: "text-red-600",
  blue: "text-blue-600",
  green: "text-green-600",
  yellow: "text-yellow-600",
};

export const STROOP_SWATCH_CLASSES: Record<StroopColor, string> = {
  red: "bg-red-600",
  blue: "bg-blue-600",
  green: "bg-green-600",
  yellow: "bg-yellow-500",
};
