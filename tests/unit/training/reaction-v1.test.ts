import { describe, expect, it } from "vitest";

import { computeReactionMetrics, validateReactionEvents } from "@/modules/training/reaction-v1";

describe("reaction-v1 metrics", () => {
  it("computes median reaction time from valid correct trials only", () => {
    const trials = [
      { trialIndex: 0, reactionMs: 50, correct: true },
      { trialIndex: 1, reactionMs: 250, correct: true },
      { trialIndex: 2, reactionMs: 400, correct: true },
      { trialIndex: 3, reactionMs: 5000, correct: true },
      { trialIndex: 4, reactionMs: 300, correct: false },
    ];

    const metrics = computeReactionMetrics(trials);
    expect(metrics.medianReactionMs).toBe(325);
    expect(metrics.accuracy).toBe(0.8);
    expect(metrics.validReactionCount).toBe(2);
    expect(metrics.calculationVersion).toBe("reaction-v1");
  });

  it("returns null median when no valid reaction times exist", () => {
    const metrics = computeReactionMetrics([
      { trialIndex: 0, reactionMs: 20, correct: true },
      { trialIndex: 1, reactionMs: 20, correct: true },
    ]);
    expect(metrics.medianReactionMs).toBeNull();
  });
});

describe("reaction-v1 validation", () => {
  it("rejects incomplete trial sets", () => {
    const result = validateReactionEvents(
      [
        {
          sequence: 0,
          eventType: "trial.stimulus",
          payload: { trialIndex: 0 },
          occurredAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      ],
      2,
    );

    expect(result.valid).toBe(false);
  });

  it("accepts paired stimulus/response events", () => {
    const base = new Date("2026-01-01T00:00:00.000Z").getTime();
    const result = validateReactionEvents(
      [
        {
          sequence: 0,
          eventType: "trial.stimulus",
          payload: { trialIndex: 0 },
          occurredAt: new Date(base),
        },
        {
          sequence: 1,
          eventType: "trial.response",
          payload: { trialIndex: 0, correct: true },
          occurredAt: new Date(base + 300),
        },
      ],
      1,
    );

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.trials[0]?.reactionMs).toBe(300);
    }
  });
});
