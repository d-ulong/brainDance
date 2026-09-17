import { STROOP_COLORS, type StroopColor } from "@/modules/training/constants";
import { getStroopSchemaForAgeBand } from "@/modules/training/stroop-v1";

export type StroopTaskMode = "name_ink" | "name_word";
export type StroopDifficulty = "easy_ink" | "easy_word" | "hard";

export type StroopTrialPlan = {
  trialIndex: number;
  inkColor: StroopColor;
  wordColor: StroopColor;
  congruent: boolean;
  taskMode: StroopTaskMode;
};

function pickRandom<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

function pickOtherColor(color: StroopColor): StroopColor {
  const others = STROOP_COLORS.filter((item) => item !== color);
  return pickRandom(others);
}

function shuffleInPlace<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = items[i]!;
    items[i] = items[j]!;
    items[j] = tmp;
  }
  return items;
}

/** Build a randomized Stroop plan. Ink/word meaning always conflict on name_ink trials. */
export function buildStroopTrialPlan(
  ageBand: string,
  difficulty: StroopDifficulty = "hard",
): StroopTrialPlan[] {
  const schema = getStroopSchemaForAgeBand(ageBand);
  const modes: StroopTaskMode[] = [];
  for (let i = 0; i < schema.trialCount; i += 1) {
    if (difficulty === "easy_ink") modes.push("name_ink");
    else if (difficulty === "easy_word") modes.push("name_word");
    else modes.push(Math.random() < 0.5 ? "name_ink" : "name_word");
  }
  shuffleInPlace(modes);

  return modes.map((taskMode, trialIndex) => {
    // Always conflict: ink color ≠ word meaning, and the visible ink is a random color.
    const inkColor = pickRandom(STROOP_COLORS);
    const wordColor = pickOtherColor(inkColor);
    return {
      trialIndex,
      inkColor,
      wordColor,
      congruent: false,
      taskMode,
    };
  });
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
