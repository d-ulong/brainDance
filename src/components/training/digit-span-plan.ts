import { getDigitSpanSchemaForAgeBand } from "@/modules/training/digit-span-v1";

export type DigitSpanMode = "forward" | "backward";
export type DigitSpanDifficulty = "easy_forward" | "easy_backward" | "hard";

export type DigitSpanAttemptPlan = {
  mode: DigitSpanMode;
  length: number;
  attemptIndex: number;
  digits: number[];
};

function shuffleInPlace<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = items[i]!;
    items[i] = items[j]!;
    items[j] = tmp;
  }
  return items;
}

/** True-random digits 0–9; adjacent digits never equal. */
export function randomDigitSequence(length: number): number[] {
  const digits: number[] = [];
  for (let i = 0; i < length; i += 1) {
    let digit = Math.floor(Math.random() * 10);
    while (i > 0 && digit === digits[i - 1]) {
      digit = Math.floor(Math.random() * 10);
    }
    digits.push(digit);
  }
  return digits;
}

export function buildDigitSpanAttemptPlan(
  ageBand: string,
  difficulty: DigitSpanDifficulty = "hard",
): DigitSpanAttemptPlan[] {
  const schema = getDigitSpanSchemaForAgeBand(ageBand);
  const attempts: DigitSpanAttemptPlan[] = [];

  const includeForward = difficulty !== "easy_backward";
  const includeBackward = difficulty !== "easy_forward";
  // Hard = both directions × base attempts (16). Easy single direction doubles attempts (also 16).
  const attemptsPer =
    includeForward && includeBackward ? schema.attemptsPerLength : schema.attemptsPerLength * 2;

  if (includeForward) {
    for (let length = schema.forwardMinLength; length <= schema.forwardMaxLength; length += 1) {
      for (let attemptIndex = 0; attemptIndex < attemptsPer; attemptIndex += 1) {
        attempts.push({
          mode: "forward",
          length,
          attemptIndex,
          digits: randomDigitSequence(length),
        });
      }
    }
  }

  if (includeBackward) {
    for (let length = schema.backwardMinLength; length <= schema.backwardMaxLength; length += 1) {
      for (let attemptIndex = 0; attemptIndex < attemptsPer; attemptIndex += 1) {
        attempts.push({
          mode: "backward",
          length,
          attemptIndex,
          digits: randomDigitSequence(length),
        });
      }
    }
  }

  if (difficulty === "hard") {
    return shuffleInPlace(attempts);
  }
  return attempts;
}

/** @deprecated Prefer randomDigitSequence; kept for test helpers that need deterministic fixtures. */
export function stimulusDigitsForAttempt(
  mode: "forward" | "backward",
  length: number,
  attemptIndex: number,
): number[] {
  const offset = mode === "forward" ? length : 2;
  return Array.from({ length }, (_, index) => ((index + attemptIndex + offset) % 9) + 1);
}

export function responseDigitsForAttempt(
  mode: "forward" | "backward",
  length: number,
  attemptIndex: number,
): number[] {
  const digits = stimulusDigitsForAttempt(mode, length, attemptIndex);
  if (mode === "forward") {
    return digits;
  }
  return [...digits].reverse();
}

export function expectedDigitSpanResponse(plan: DigitSpanAttemptPlan): number[] {
  if (plan.mode === "forward") return [...plan.digits];
  return [...plan.digits].reverse();
}

export const SEQUENTIAL_DIGIT_MS = 800;

/** Whole-sequence display duration by length (easy / non-sequential). */
export function wholeSequenceDisplayMs(length: number): number {
  if (length <= 5) return 2000;
  if (length <= 8) return 4000;
  if (length <= 14) return 7000;
  return 10000;
}
