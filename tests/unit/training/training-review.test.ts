import { describe, expect, it } from "vitest";

import { buildTrainingTrialReview } from "@/modules/training/training-review";

describe("buildTrainingTrialReview", () => {
  it("builds reaction rows without exposing raw payloads", () => {
    const events = [
      {
        sequence: 0,
        eventType: "trial.stimulus",
        payload: { trialIndex: 0, secret: "hidden" },
        occurredAt: new Date("2026-01-01T00:00:00.000Z"),
      },
      {
        sequence: 1,
        eventType: "trial.response",
        payload: { trialIndex: 0, correct: true, inputMethod: "keyboard" },
        occurredAt: new Date("2026-01-01T00:00:00.500Z"),
      },
    ];
    const review = buildTrainingTrialReview("reaction", events, { trialCount: 1 });
    expect(review).toHaveLength(1);
    expect(review?.[0]).toMatchObject({
      kind: "reaction",
      correct: true,
      actualAction: "键盘",
    });
    expect(JSON.stringify(review)).not.toContain("hidden");
  });

  it("returns null for invalid sessions", () => {
    expect(buildTrainingTrialReview("reaction", [], {})).toBeNull();
  });

  it("returns null when stroop events fail validation", () => {
    const events = [
      {
        sequence: 0,
        eventType: "trial.stimulus",
        payload: { trialIndex: 0, inkColor: "red", wordColor: "blue", taskMode: "name_ink" },
        occurredAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ];
    expect(buildTrainingTrialReview("stroop", events, { trialCount: 20 })).toBeNull();
  });

  it("returns null for incomplete reaction event streams", () => {
    const events = [
      {
        sequence: 0,
        eventType: "trial.stimulus",
        payload: { trialIndex: 0, secret: "hidden" },
        occurredAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ];
    expect(buildTrainingTrialReview("reaction", events, { trialCount: 5 })).toBeNull();
  });
});
