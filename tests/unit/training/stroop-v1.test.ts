import { describe, expect, it } from "vitest";

import { STROOP_COLORS } from "@/modules/training/constants";
import {
  computeStroopMetrics,
  getStroopSchemaForAgeBand,
  validateStroopEvents,
} from "@/modules/training/stroop-v1";

function buildStroopEvents(input: {
  trials: Array<{
    trialIndex: number;
    inkColor: (typeof STROOP_COLORS)[number];
    wordColor: (typeof STROOP_COLORS)[number];
    selectedColor: (typeof STROOP_COLORS)[number];
    reactionMs: number;
  }>;
}) {
  const base = new Date("2026-01-01T00:00:00.000Z").getTime();
  const events = [];
  let sequence = 0;
  for (const trial of input.trials) {
    events.push({
      sequence: sequence++,
      eventType: "trial.stimulus",
      payload: {
        trialIndex: trial.trialIndex,
        inkColor: trial.inkColor,
        wordColor: trial.wordColor,
      },
      occurredAt: new Date(base + trial.trialIndex * 1000),
    });
    events.push({
      sequence: sequence++,
      eventType: "trial.response",
      payload: { trialIndex: trial.trialIndex, selectedColor: trial.selectedColor },
      occurredAt: new Date(base + trial.trialIndex * 1000 + trial.reactionMs),
    });
  }
  return events;
}

describe("stroop-v1 validation", () => {
  const schema = getStroopSchemaForAgeBand("9-12");

  it("rejects incomplete trial sets", () => {
    const result = validateStroopEvents(
      buildStroopEvents({
        trials: [
          {
            trialIndex: 0,
            inkColor: "red",
            wordColor: "red",
            selectedColor: "red",
            reactionMs: 400,
          },
        ],
      }),
      schema,
    );
    expect(result.valid).toBe(false);
  });

  it("rejects congruency quota mismatch", () => {
    const trials = Array.from({ length: schema.trialCount }, (_, trialIndex) => ({
      trialIndex,
      inkColor: "red" as const,
      wordColor: "red" as const,
      selectedColor: "red" as const,
      reactionMs: 400,
    }));
    const result = validateStroopEvents(buildStroopEvents({ trials }), schema);
    expect(result.valid).toBe(false);
  });

  it("accepts balanced congruent and incongruent trials", () => {
    const trials = Array.from({ length: schema.trialCount }, (_, trialIndex) => {
      const congruent = trialIndex < schema.congruentQuota;
      return {
        trialIndex,
        inkColor: "red" as const,
        wordColor: congruent ? ("red" as const) : ("blue" as const),
        selectedColor: "red" as const,
        reactionMs: 400 + trialIndex * 10,
      };
    });
    const result = validateStroopEvents(buildStroopEvents({ trials }), schema);
    expect(result.valid).toBe(true);
  });
});

describe("stroop-v1 metrics", () => {
  const schema = getStroopSchemaForAgeBand("9-12");

  it("computes typed accuracies, medians, and interference delta", () => {
    const trials = Array.from({ length: schema.trialCount }, (_, trialIndex) => {
      const congruent = trialIndex < schema.congruentQuota;
      return {
        trialIndex,
        inkColor: "red" as const,
        wordColor: congruent ? ("red" as const) : ("blue" as const),
        congruency: congruent ? ("congruent" as const) : ("incongruent" as const),
        selectedColor: "red" as const,
        correct: true,
        reactionMs: congruent ? 300 : 500,
      };
    });

    const metrics = computeStroopMetrics({ trials, expectedTrialCount: schema.trialCount }, schema);
    expect(metrics.rejectReason).toBeUndefined();
    expect(metrics.rows.find((row) => row.metricKey === "congruent_accuracy")?.value).toBe(1);
    expect(metrics.rows.find((row) => row.metricKey === "incongruent_accuracy")?.value).toBe(1);
    expect(metrics.rows.find((row) => row.metricKey === "interference_delta")?.value).toBe(200);
  });

  it("rejects sessions without valid medians for both trial types", () => {
    const trials = Array.from({ length: schema.trialCount }, (_, trialIndex) => {
      const congruent = trialIndex < schema.congruentQuota;
      return {
        trialIndex,
        inkColor: "red" as const,
        wordColor: congruent ? ("red" as const) : ("blue" as const),
        congruency: congruent ? ("congruent" as const) : ("incongruent" as const),
        selectedColor: congruent ? ("red" as const) : ("blue" as const),
        correct: congruent,
        reactionMs: 50,
      };
    });

    const metrics = computeStroopMetrics({ trials, expectedTrialCount: schema.trialCount }, schema);
    expect(metrics.rejectReason).toContain("median");
    expect(metrics.rows).toHaveLength(0);
  });
});
