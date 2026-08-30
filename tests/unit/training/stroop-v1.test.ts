import { describe, expect, it } from "vitest";

import { STROOP_COLORS } from "@/modules/training/constants";
import {
  computeStroopMetrics,
  decodeStroopMetricSchema,
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

  it("AC-M5-02: rejects unknown event types", () => {
    const result = validateStroopEvents(
      [
        {
          sequence: 0,
          eventType: "trial.unknown",
          payload: { trialIndex: 0 },
          occurredAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      ],
      schema,
    );
    expect(result.valid).toBe(false);
  });

  it("AC-M5-02: rejects duplicate stimulus events", () => {
    const base = new Date("2026-01-01T00:00:00.000Z");
    const result = validateStroopEvents(
      [
        {
          sequence: 0,
          eventType: "trial.stimulus",
          payload: { trialIndex: 0, inkColor: "red", wordColor: "red" },
          occurredAt: base,
        },
        {
          sequence: 1,
          eventType: "trial.stimulus",
          payload: { trialIndex: 0, inkColor: "red", wordColor: "red" },
          occurredAt: base,
        },
      ],
      schema,
    );
    expect(result.valid).toBe(false);
  });

  it("AC-M5-02: rejects response without matching stimulus", () => {
    const result = validateStroopEvents(
      [
        {
          sequence: 0,
          eventType: "trial.response",
          payload: { trialIndex: 0, selectedColor: "red" },
          occurredAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      ],
      schema,
    );
    expect(result.valid).toBe(false);
  });

  it("AC-M5-02: rejects duplicate response for the same trial", () => {
    const base = new Date("2026-01-01T00:00:00.000Z").getTime();
    const result = validateStroopEvents(
      [
        {
          sequence: 0,
          eventType: "trial.stimulus",
          payload: { trialIndex: 0, inkColor: "red", wordColor: "red" },
          occurredAt: new Date(base),
        },
        {
          sequence: 1,
          eventType: "trial.response",
          payload: { trialIndex: 0, selectedColor: "red" },
          occurredAt: new Date(base + 400),
        },
        {
          sequence: 2,
          eventType: "trial.response",
          payload: { trialIndex: 0, selectedColor: "red" },
          occurredAt: new Date(base + 500),
        },
      ],
      schema,
    );
    expect(result.valid).toBe(false);
  });

  it("AC-M5-02: rejects invalid Stroop stimulus timestamp", () => {
    const result = validateStroopEvents(
      [
        {
          sequence: 0,
          eventType: "trial.stimulus",
          payload: { trialIndex: 0, inkColor: "red", wordColor: "red" },
          occurredAt: new Date("invalid"),
        },
      ],
      schema,
    );
    expect(result.valid).toBe(false);
  });

  it("AC-M5-02: rejects invalid Stroop response timestamp", () => {
    const base = new Date("2026-01-01T00:00:00.000Z");
    const result = validateStroopEvents(
      [
        {
          sequence: 0,
          eventType: "trial.stimulus",
          payload: { trialIndex: 0, inkColor: "red", wordColor: "red" },
          occurredAt: base,
        },
        {
          sequence: 1,
          eventType: "trial.response",
          payload: { trialIndex: 0, selectedColor: "red" },
          occurredAt: new Date("invalid"),
        },
      ],
      schema,
    );
    expect(result.valid).toBe(false);
  });

  it("AC-M5-02: rejects response before stimulus time", () => {
    const base = new Date("2026-01-01T00:00:00.000Z");
    const result = validateStroopEvents(
      [
        {
          sequence: 0,
          eventType: "trial.stimulus",
          payload: { trialIndex: 0, inkColor: "red", wordColor: "red" },
          occurredAt: base,
        },
        {
          sequence: 1,
          eventType: "trial.response",
          payload: { trialIndex: 0, selectedColor: "red" },
          occurredAt: new Date(base.getTime() - 1),
        },
      ],
      schema,
    );
    expect(result.valid).toBe(false);
  });

  it("AC-M5-02: accepts wrong answers as valid trials with reduced accuracy", () => {
    const trials = Array.from({ length: schema.trialCount }, (_, trialIndex) => {
      const congruent = trialIndex < schema.congruentQuota;
      return {
        trialIndex,
        inkColor: "red" as const,
        wordColor: congruent ? ("red" as const) : ("blue" as const),
        selectedColor: congruent || trialIndex % 2 === 0 ? ("red" as const) : ("blue" as const),
        reactionMs: 400 + trialIndex * 10,
      };
    });
    const result = validateStroopEvents(buildStroopEvents({ trials }), schema);
    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }

    const metrics = computeStroopMetrics(result.data, schema);
    expect(metrics.rejectReason).toBeUndefined();
    expect(metrics.rows.find((row) => row.metricKey === "congruent_accuracy")?.value).toBe(1);
    expect(
      metrics.rows.find((row) => row.metricKey === "incongruent_accuracy")?.value,
    ).toBeLessThan(1);
  });
});

describe("stroop-v1 schema", () => {
  it("AC-M5-02: rejects non-integer trial counts and quotas", () => {
    expect(
      decodeStroopMetricSchema({
        trialCount: 16.5,
        congruentQuota: 8,
        incongruentQuota: 8,
        colors: [...STROOP_COLORS],
        minValidMs: 200,
        maxValidMs: 4000,
      }),
    ).toBeNull();
  });

  it("AC-M5-02: rejects non-finite time boundaries", () => {
    expect(
      decodeStroopMetricSchema({
        trialCount: 16,
        congruentQuota: 8,
        incongruentQuota: 8,
        colors: [...STROOP_COLORS],
        minValidMs: Number.NaN,
        maxValidMs: 4000,
      }),
    ).toBeNull();
  });

  it("AC-M5-02: rejects values above MAX_SAFE_INTEGER", () => {
    const unsafe = Number.MAX_SAFE_INTEGER + 1;
    expect(
      decodeStroopMetricSchema({
        trialCount: unsafe,
        congruentQuota: 8,
        incongruentQuota: 8,
        colors: [...STROOP_COLORS],
        minValidMs: 200,
        maxValidMs: 4000,
      }),
    ).toBeNull();
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
