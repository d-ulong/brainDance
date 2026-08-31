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
        digits: Array.from({ length }, (_, index) => ((index + attemptIndex + length) % 9) + 1),
      });
    }
  }

  for (let length = schema.backwardMinLength; length <= schema.backwardMaxLength; length += 1) {
    for (let attemptIndex = 0; attemptIndex < schema.attemptsPerLength; attemptIndex += 1) {
      attempts.push({
        mode: "backward",
        length,
        attemptIndex,
        digits: Array.from({ length }, (_, index) => ((index + attemptIndex + 2) % 9) + 1),
      });
    }
  }

  return attempts;
}

export function expectedDigitSpanResponse(plan: DigitSpanAttemptPlan): number[] {
  if (plan.mode === "forward") {
    return plan.digits;
  }
  return [...plan.digits].reverse();
}
