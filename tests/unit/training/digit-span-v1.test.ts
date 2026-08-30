import { describe, expect, it } from "vitest";

import {
  computeDigitSpanMetrics,
  decodeDigitSpanMetricSchema,
  getDigitSpanSchemaForAgeBand,
  validateDigitSpanEvents,
} from "@/modules/training/digit-span-v1";

function buildDigitSpanEvents(
  schema: ReturnType<typeof getDigitSpanSchemaForAgeBand>,
  responses: Record<string, number[]>,
) {
  const events: Array<{
    sequence: number;
    eventType: string;
    payload: Record<string, unknown>;
    occurredAt: Date;
  }> = [];
  let sequence = 0;
  const pushAttempt = (
    mode: "forward" | "backward",
    length: number,
    attemptIndex: number,
    sequenceDigits: number[],
  ) => {
    const key = `${mode}:${length}:${attemptIndex}`;
    events.push({
      sequence: sequence++,
      eventType: "span.stimulus",
      payload: { mode, length, attemptIndex, sequence: sequenceDigits },
      occurredAt: new Date(`2026-01-01T00:00:${String(sequence).padStart(2, "0")}.000Z`),
    });
    events.push({
      sequence: sequence++,
      eventType: "span.response",
      payload: {
        mode,
        length,
        attemptIndex,
        sequence: sequenceDigits,
        response: responses[key] ?? sequenceDigits,
      },
      occurredAt: new Date(`2026-01-01T00:00:${String(sequence).padStart(2, "0")}.000Z`),
    });
  };

  for (let length = schema.forwardMinLength; length <= schema.forwardMaxLength; length += 1) {
    for (let attemptIndex = 0; attemptIndex < schema.attemptsPerLength; attemptIndex += 1) {
      const digits = Array.from({ length }, (_, index) => index + 1);
      pushAttempt("forward", length, attemptIndex, digits);
    }
  }
  for (let length = schema.backwardMinLength; length <= schema.backwardMaxLength; length += 1) {
    for (let attemptIndex = 0; attemptIndex < schema.attemptsPerLength; attemptIndex += 1) {
      const digits = Array.from({ length }, (_, index) => index + 2);
      pushAttempt("backward", length, attemptIndex, digits);
    }
  }

  return events;
}

describe("digit-span-v1 validation", () => {
  const schema = getDigitSpanSchemaForAgeBand("9-12");

  it("rejects incomplete attempt sets", () => {
    const result = validateDigitSpanEvents(
      [
        {
          sequence: 0,
          eventType: "span.stimulus",
          payload: { mode: "forward", length: 2, attemptIndex: 0, sequence: [1, 2] },
          occurredAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      ],
      schema,
    );
    expect(result.valid).toBe(false);
  });

  it("rejects backward attempts before forward attempts complete", () => {
    const events = buildDigitSpanEvents(schema, {});
    const backwardIndex = events.findIndex((event) => event.payload.mode === "backward");
    const swapped = [
      ...events.slice(backwardIndex, backwardIndex + 2),
      ...events.slice(0, backwardIndex),
      ...events.slice(backwardIndex + 2),
    ];
    const result = validateDigitSpanEvents(swapped, schema);
    expect(result.valid).toBe(false);
  });

  it("accepts full forward and backward ladder", () => {
    const result = validateDigitSpanEvents(buildDigitSpanEvents(schema, {}), schema);
    expect(result.valid).toBe(true);
  });

  it("AC-M5-03: rejects unknown event types", () => {
    const result = validateDigitSpanEvents(
      [
        {
          sequence: 0,
          eventType: "span.unknown",
          payload: { mode: "forward", length: 2, attemptIndex: 0, sequence: [1, 2] },
          occurredAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      ],
      schema,
    );
    expect(result.valid).toBe(false);
  });

  it("AC-M5-03: rejects duplicate span stimulus", () => {
    const base = new Date("2026-01-01T00:00:00.000Z");
    const result = validateDigitSpanEvents(
      [
        {
          sequence: 0,
          eventType: "span.stimulus",
          payload: { mode: "forward", length: 2, attemptIndex: 0, sequence: [1, 2] },
          occurredAt: base,
        },
        {
          sequence: 1,
          eventType: "span.stimulus",
          payload: { mode: "forward", length: 2, attemptIndex: 0, sequence: [1, 2] },
          occurredAt: base,
        },
      ],
      schema,
    );
    expect(result.valid).toBe(false);
  });

  it("AC-M5-03: rejects span length outside definition range", () => {
    const result = validateDigitSpanEvents(
      [
        {
          sequence: 0,
          eventType: "span.stimulus",
          payload: { mode: "forward", length: 99, attemptIndex: 0, sequence: [1, 2] },
          occurredAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      ],
      schema,
    );
    expect(result.valid).toBe(false);
  });

  it("AC-M5-03: rejects invalid span response payload", () => {
    const result = validateDigitSpanEvents(
      [
        {
          sequence: 0,
          eventType: "span.response",
          payload: { mode: "forward", length: 2, attemptIndex: 0, sequence: [1, 2], response: [1] },
          occurredAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      ],
      schema,
    );
    expect(result.valid).toBe(false);
  });

  it("AC-M5-03: rejects duplicate span response for the same attempt", () => {
    const events = buildDigitSpanEvents(schema, {});
    const forwardResponseIndex = events.findIndex(
      (event) => event.eventType === "span.response" && event.payload.mode === "forward",
    );
    const duplicated = [
      ...events.slice(0, forwardResponseIndex + 1),
      events[forwardResponseIndex]!,
      ...events.slice(forwardResponseIndex + 1),
    ];
    const result = validateDigitSpanEvents(duplicated, schema);
    expect(result.valid).toBe(false);
  });

  it("AC-M5-03: rejects invalid span stimulus timestamp", () => {
    const result = validateDigitSpanEvents(
      [
        {
          sequence: 0,
          eventType: "span.stimulus",
          payload: { mode: "forward", length: 2, attemptIndex: 0, sequence: [1, 2] },
          occurredAt: new Date("invalid"),
        },
      ],
      schema,
    );
    expect(result.valid).toBe(false);
  });

  it("AC-M5-03: rejects invalid span response timestamp", () => {
    const result = validateDigitSpanEvents(
      [
        {
          sequence: 0,
          eventType: "span.stimulus",
          payload: { mode: "forward", length: 2, attemptIndex: 0, sequence: [1, 2] },
          occurredAt: new Date("2026-01-01T00:00:10.000Z"),
        },
        {
          sequence: 1,
          eventType: "span.response",
          payload: {
            mode: "forward",
            length: 2,
            attemptIndex: 0,
            sequence: [1, 2],
            response: [1, 2],
          },
          occurredAt: new Date("invalid"),
        },
      ],
      schema,
    );
    expect(result.valid).toBe(false);
  });

  it("AC-M5-03: rejects span response before stimulus time", () => {
    const stimulusAt = new Date("2026-01-01T00:00:10.000Z");
    const result = validateDigitSpanEvents(
      [
        {
          sequence: 0,
          eventType: "span.stimulus",
          payload: { mode: "forward", length: 2, attemptIndex: 0, sequence: [1, 2] },
          occurredAt: stimulusAt,
        },
        {
          sequence: 1,
          eventType: "span.response",
          payload: {
            mode: "forward",
            length: 2,
            attemptIndex: 0,
            sequence: [1, 2],
            response: [1, 2],
          },
          occurredAt: new Date(stimulusAt.getTime() - 1),
        },
      ],
      schema,
    );
    expect(result.valid).toBe(false);
  });

  it("AC-M5-03: accepts wrong answers as valid attempts with reduced max spans", () => {
    const responses: Record<string, number[]> = {
      "backward:4:0": [5, 4, 3, 2],
    };
    for (let length = schema.forwardMinLength; length <= schema.forwardMaxLength; length += 1) {
      for (let attemptIndex = 0; attemptIndex < schema.attemptsPerLength; attemptIndex += 1) {
        responses[`forward:${length}:${attemptIndex}`] = Array.from({ length }, () => 9);
      }
    }
    const validation = validateDigitSpanEvents(buildDigitSpanEvents(schema, responses), schema);
    expect(validation.valid).toBe(true);
    if (!validation.valid) {
      return;
    }

    const metrics = computeDigitSpanMetrics(validation.data);
    expect(metrics.rows.find((row) => row.metricKey === "forward_max_span")?.value).toBe(0);
    expect(metrics.rows.find((row) => row.metricKey === "backward_max_span")?.value).toBe(4);
  });
});

describe("digit-span-v1 schema", () => {
  it("AC-M5-03: rejects non-integer length and quota fields", () => {
    expect(
      decodeDigitSpanMetricSchema({
        forwardMinLength: 2.5,
        forwardMaxLength: 5,
        backwardMinLength: 2,
        backwardMaxLength: 4,
        attemptsPerLength: 2,
      }),
    ).toBeNull();
  });

  it("AC-M5-03: rejects values above MAX_SAFE_INTEGER", () => {
    const unsafe = Number.MAX_SAFE_INTEGER + 1;
    expect(
      decodeDigitSpanMetricSchema({
        forwardMinLength: unsafe,
        forwardMaxLength: 5,
        backwardMinLength: 2,
        backwardMaxLength: 4,
        attemptsPerLength: 2,
      }),
    ).toBeNull();
  });
});

describe("digit-span-v1 metrics", () => {
  const schema = getDigitSpanSchemaForAgeBand("9-12");

  it("computes separate forward and backward max spans", () => {
    const responses: Record<string, number[]> = {
      "forward:5:0": [1, 2, 3, 4, 5],
      "forward:5:1": [9, 9, 9, 9, 9],
      "backward:4:0": [5, 4, 3, 2],
      "backward:4:1": [1, 1, 1, 1],
    };
    const validation = validateDigitSpanEvents(buildDigitSpanEvents(schema, responses), schema);
    expect(validation.valid).toBe(true);
    if (!validation.valid) {
      return;
    }

    const metrics = computeDigitSpanMetrics(validation.data);
    expect(metrics.rows.find((row) => row.metricKey === "forward_max_span")?.value).toBe(5);
    expect(metrics.rows.find((row) => row.metricKey === "backward_max_span")?.value).toBe(4);
  });
});
