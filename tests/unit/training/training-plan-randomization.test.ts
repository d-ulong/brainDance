import { describe, expect, it } from "vitest";

import { buildStroopTrialPlan } from "@/components/training/stroop-trial-plan";
import {
  buildDigitSpanAttemptPlan,
  randomDigitSequence,
  wholeSequenceDisplayMs,
} from "@/components/training/digit-span-plan";

describe("stroop trial plan randomization", () => {
  it("never pairs the same ink and word meaning on ink-naming trials", () => {
    const plan = buildStroopTrialPlan("9-12", "hard");
    expect(plan.length).toBeGreaterThan(0);
    for (const trial of plan) {
      if (trial.taskMode === "name_ink") {
        expect(trial.inkColor).not.toBe(trial.wordColor);
        expect(trial.congruent).toBe(false);
      }
    }
  });

  it("uses a single task mode for easy difficulties", () => {
    const inkOnly = buildStroopTrialPlan("9-12", "easy_ink");
    expect(inkOnly.every((trial) => trial.taskMode === "name_ink")).toBe(true);
    const wordOnly = buildStroopTrialPlan("9-12", "easy_word");
    expect(wordOnly.every((trial) => trial.taskMode === "name_word")).toBe(true);
  });

  it("always uses conflicting random ink colors, including name_word trials", () => {
    const plan = buildStroopTrialPlan("9-12", "easy_word");
    expect(plan).toHaveLength(16);
    for (const trial of plan) {
      expect(trial.inkColor).not.toBe(trial.wordColor);
      expect(trial.congruent).toBe(false);
    }
  });
});

describe("digit span display timing", () => {
  it("uses graded whole-sequence durations", () => {
    expect(wholeSequenceDisplayMs(4)).toBe(2000);
    expect(wholeSequenceDisplayMs(5)).toBe(2000);
    expect(wholeSequenceDisplayMs(6)).toBe(4000);
    expect(wholeSequenceDisplayMs(8)).toBe(4000);
    expect(wholeSequenceDisplayMs(9)).toBe(7000);
    expect(wholeSequenceDisplayMs(14)).toBe(7000);
    expect(wholeSequenceDisplayMs(15)).toBe(10000);
  });
});

describe("digit span randomization", () => {
  it("builds non-consecutive adjacent digits", () => {
    for (let i = 0; i < 40; i += 1) {
      const digits = randomDigitSequence(8);
      for (let index = 1; index < digits.length; index += 1) {
        expect(digits[index]).not.toBe(digits[index - 1]);
      }
    }
  });

  it("limits easy plans to a single direction", () => {
    const forward = buildDigitSpanAttemptPlan("9-12", "easy_forward");
    expect(forward.every((attempt) => attempt.mode === "forward")).toBe(true);
    const backward = buildDigitSpanAttemptPlan("9-12", "easy_backward");
    expect(backward.every((attempt) => attempt.mode === "backward")).toBe(true);
  });

  it("defaults hard plans to 16 attempts for 9-12", () => {
    expect(buildDigitSpanAttemptPlan("9-12", "hard")).toHaveLength(16);
  });

  it("uses 16 attempts for easy forward/backward starting at length 4", () => {
    const forward = buildDigitSpanAttemptPlan("9-12", "easy_forward");
    expect(forward).toHaveLength(16);
    expect(forward.every((attempt) => attempt.length >= 4)).toBe(true);
    const backward = buildDigitSpanAttemptPlan("9-12", "easy_backward");
    expect(backward).toHaveLength(16);
    expect(backward.every((attempt) => attempt.length >= 4)).toBe(true);
  });
});
