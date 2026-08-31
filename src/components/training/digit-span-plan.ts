import { getDigitSpanSchemaForAgeBand } from "@/modules/training/digit-span-v1";

export type DigitSpanAttemptPlan = {
  mode: "forward" | "backward";
  length: number;
  attemptIndex: number;
  digits: number[];
};

export function buildDigitSpanAttemptPlan(ageBand: string): DigitSpanAttemptPlan[] {
  const schema = getDigitSpanSchemaForAgeBand(ageBand);
  const attempts: DigitSpanAttemptPlan[] = [];

  for (let length = schema.forwardMinLength; length <= schema.forwardMaxLength; length += 1) {
    for (let attemptIndex = 0; attemptIndex < schema.attemptsPerLength; attemptIndex += 1) {
      attempts.push({
        mode: "forward",
        length,
        attemptIndex,
        digits: stimulusDigitsForAttempt("forward", length, attemptIndex),
      });
    }
  }

  for (let length = schema.backwardMinLength; length <= schema.backwardMaxLength; length += 1) {
    for (let attemptIndex = 0; attemptIndex < schema.attemptsPerLength; attemptIndex += 1) {
      attempts.push({
        mode: "backward",
        length,
        attemptIndex,
        digits: stimulusDigitsForAttempt("backward", length, attemptIndex),
      });
    }
  }

  return attempts;
}

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
  return responseDigitsForAttempt(plan.mode, plan.length, plan.attemptIndex);
}
