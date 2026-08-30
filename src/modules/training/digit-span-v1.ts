import { DIGIT_SPAN_CALCULATION_VERSION } from "@/modules/training/constants";
import type { ProtocolMetricRow, TrainingEventRecord } from "@/modules/training/protocol";
import { isSafePositiveInt } from "@/modules/training/protocol-schema";

export type DigitSpanMode = "forward" | "backward";

export type DigitSpanMetricSchema = {
  forwardMinLength: number;
  forwardMaxLength: number;
  backwardMinLength: number;
  backwardMaxLength: number;
  attemptsPerLength: number;
};

export type DigitSpanAttemptRecord = {
  mode: DigitSpanMode;
  length: number;
  attemptIndex: number;
  sequence: number[];
  response: number[];
  correct: boolean;
};

export type DigitSpanValidatedData = {
  attempts: DigitSpanAttemptRecord[];
};

const DEFAULT_DIGIT_SPAN_SCHEMAS: Record<string, DigitSpanMetricSchema> = {
  "5-8": {
    forwardMinLength: 2,
    forwardMaxLength: 4,
    backwardMinLength: 2,
    backwardMaxLength: 3,
    attemptsPerLength: 2,
  },
  "9-12": {
    forwardMinLength: 2,
    forwardMaxLength: 5,
    backwardMinLength: 2,
    backwardMaxLength: 4,
    attemptsPerLength: 2,
  },
  "13-18": {
    forwardMinLength: 3,
    forwardMaxLength: 6,
    backwardMinLength: 2,
    backwardMaxLength: 5,
    attemptsPerLength: 2,
  },
};

export function decodeDigitSpanMetricSchema(
  raw: Record<string, unknown>,
): DigitSpanMetricSchema | null {
  const forwardMinLength = raw.forwardMinLength;
  const forwardMaxLength = raw.forwardMaxLength;
  const backwardMinLength = raw.backwardMinLength;
  const backwardMaxLength = raw.backwardMaxLength;
  const attemptsPerLength = raw.attemptsPerLength;

  if (
    !isSafePositiveInt(forwardMinLength) ||
    !isSafePositiveInt(forwardMaxLength) ||
    !isSafePositiveInt(backwardMinLength) ||
    !isSafePositiveInt(backwardMaxLength) ||
    !isSafePositiveInt(attemptsPerLength) ||
    forwardMaxLength < forwardMinLength ||
    backwardMaxLength < backwardMinLength
  ) {
    return null;
  }

  return {
    forwardMinLength,
    forwardMaxLength,
    backwardMinLength,
    backwardMaxLength,
    attemptsPerLength,
  };
}

export function getDigitSpanSchemaForAgeBand(ageBand: string): DigitSpanMetricSchema {
  return DEFAULT_DIGIT_SPAN_SCHEMAS[ageBand] ?? DEFAULT_DIGIT_SPAN_SCHEMAS["9-12"]!;
}

export function getDigitSpanExpectedAttemptCount(schema: Record<string, unknown>): number {
  const decoded = decodeDigitSpanMetricSchema(schema);
  if (!decoded) {
    return 0;
  }
  return countAttemptsForSchema(decoded);
}

export function countAttemptsForSchema(schema: DigitSpanMetricSchema): number {
  const forwardLengths = schema.forwardMaxLength - schema.forwardMinLength + 1;
  const backwardLengths = schema.backwardMaxLength - schema.backwardMinLength + 1;
  return (forwardLengths + backwardLengths) * schema.attemptsPerLength;
}

export function validateDigitSpanEvents(
  events: TrainingEventRecord[],
  schemaInput: Record<string, unknown>,
): { valid: true; data: DigitSpanValidatedData } | { valid: false; reason: string } {
  const schema = decodeDigitSpanMetricSchema(schemaInput);
  if (!schema) {
    return { valid: false, reason: "Invalid digit-span definition schema" };
  }

  const stimuli = new Map<string, { sequence: number[]; occurredAt: Date }>();
  const attempts: DigitSpanAttemptRecord[] = [];
  let seenBackward = false;

  for (const event of events) {
    if (event.eventType === "span.stimulus") {
      const parsed = readSpanEvent(event.payload);
      if (!parsed) {
        return { valid: false, reason: "Invalid span stimulus payload" };
      }

      if (parsed.mode === "backward") {
        seenBackward = true;
      } else if (seenBackward) {
        return { valid: false, reason: "Forward attempts must precede backward attempts" };
      }

      if (!isLengthInRange(parsed.mode, parsed.length, schema)) {
        return { valid: false, reason: "Span length out of definition range" };
      }
      if (parsed.attemptIndex < 0 || parsed.attemptIndex >= schema.attemptsPerLength) {
        return { valid: false, reason: "Attempt index out of range" };
      }
      if (!isValidDigitSequence(parsed.sequence, parsed.length)) {
        return { valid: false, reason: "Invalid digit sequence in stimulus" };
      }

      const key = attemptKey(parsed.mode, parsed.length, parsed.attemptIndex);
      if (stimuli.has(key)) {
        return { valid: false, reason: "Duplicate span stimulus" };
      }
      stimuli.set(key, { sequence: parsed.sequence, occurredAt: event.occurredAt });
      continue;
    }

    if (event.eventType === "span.response") {
      const parsed = readSpanEvent(event.payload);
      if (!parsed || parsed.sequence.length === 0) {
        return { valid: false, reason: "Invalid span response payload" };
      }

      const key = attemptKey(parsed.mode, parsed.length, parsed.attemptIndex);
      const stimulus = stimuli.get(key);
      if (!stimulus) {
        return { valid: false, reason: "Span response without matching stimulus" };
      }
      if (event.occurredAt.getTime() <= stimulus.occurredAt.getTime()) {
        return { valid: false, reason: "Span response occurred before or at stimulus time" };
      }
      if (!arraysEqual(parsed.sequence, stimulus.sequence)) {
        return { valid: false, reason: "Response sequence does not match stimulus" };
      }
      if (!isValidDigitSequence(parsed.response, parsed.length)) {
        return { valid: false, reason: "Invalid digit sequence in response" };
      }

      const correct =
        parsed.mode === "forward"
          ? arraysEqual(parsed.response, stimulus.sequence)
          : arraysEqual(parsed.response, [...stimulus.sequence].reverse());

      attempts.push({
        mode: parsed.mode,
        length: parsed.length,
        attemptIndex: parsed.attemptIndex,
        sequence: stimulus.sequence,
        response: parsed.response,
        correct,
      });
      continue;
    }

    return { valid: false, reason: `Unknown event type: ${event.eventType}` };
  }

  const expectedAttempts = countAttemptsForSchema(schema);
  if (attempts.length !== expectedAttempts) {
    return {
      valid: false,
      reason: `Expected ${expectedAttempts} span attempts, got ${attempts.length}`,
    };
  }

  const expectedKeys = buildExpectedAttemptKeys(schema);
  const actualKeys = attempts.map((a) => attemptKey(a.mode, a.length, a.attemptIndex)).sort();
  if (!stringArraysEqual(actualKeys, [...expectedKeys].sort())) {
    return { valid: false, reason: "Missing or duplicate span attempts" };
  }

  return { valid: true, data: { attempts } };
}

export function computeDigitSpanMetrics(data: DigitSpanValidatedData): {
  calculationVersion: typeof DIGIT_SPAN_CALCULATION_VERSION;
  rows: ProtocolMetricRow[];
} {
  const forwardMaxSpan = maxCorrectSpan(data.attempts.filter((a) => a.mode === "forward"));
  const backwardMaxSpan = maxCorrectSpan(data.attempts.filter((a) => a.mode === "backward"));
  const forwardAttemptCount = data.attempts.filter((a) => a.mode === "forward").length;
  const backwardAttemptCount = data.attempts.filter((a) => a.mode === "backward").length;

  return {
    calculationVersion: DIGIT_SPAN_CALCULATION_VERSION,
    rows: [
      {
        metricKey: "forward_max_span",
        value: forwardMaxSpan,
        unit: "digits",
        isValid: true,
        calculationVersion: DIGIT_SPAN_CALCULATION_VERSION,
      },
      {
        metricKey: "backward_max_span",
        value: backwardMaxSpan,
        unit: "digits",
        isValid: true,
        calculationVersion: DIGIT_SPAN_CALCULATION_VERSION,
      },
      {
        metricKey: "forward_attempt_count",
        value: forwardAttemptCount,
        unit: "count",
        isValid: true,
        calculationVersion: DIGIT_SPAN_CALCULATION_VERSION,
      },
      {
        metricKey: "backward_attempt_count",
        value: backwardAttemptCount,
        unit: "count",
        isValid: true,
        calculationVersion: DIGIT_SPAN_CALCULATION_VERSION,
      },
    ],
  };
}

function maxCorrectSpan(attempts: DigitSpanAttemptRecord[]): number {
  let maxSpan = 0;
  for (const attempt of attempts) {
    if (attempt.correct && attempt.length > maxSpan) {
      maxSpan = attempt.length;
    }
  }
  return maxSpan;
}

function readSpanEvent(payload: Record<string, unknown>): {
  mode: DigitSpanMode;
  length: number;
  attemptIndex: number;
  sequence: number[];
  response: number[];
} | null {
  const mode = payload.mode;
  const length = payload.length;
  const attemptIndex = payload.attemptIndex;
  const sequence = payload.sequence;
  const response = payload.response;

  if (mode !== "forward" && mode !== "backward") {
    return null;
  }
  if (typeof length !== "number" || !Number.isInteger(length) || length <= 0) {
    return null;
  }
  if (typeof attemptIndex !== "number" || !Number.isInteger(attemptIndex) || attemptIndex < 0) {
    return null;
  }
  if (!Array.isArray(sequence)) {
    return null;
  }

  const parsedSequence = sequence.map((digit) => (typeof digit === "number" ? digit : NaN));
  if (parsedSequence.some((digit) => !Number.isInteger(digit))) {
    return null;
  }

  const parsedResponse = Array.isArray(response)
    ? response.map((digit) => (typeof digit === "number" ? digit : NaN))
    : [];

  if (parsedResponse.some((digit) => !Number.isInteger(digit))) {
    return null;
  }

  return {
    mode,
    length,
    attemptIndex,
    sequence: parsedSequence,
    response: parsedResponse,
  };
}

function isLengthInRange(
  mode: DigitSpanMode,
  length: number,
  schema: DigitSpanMetricSchema,
): boolean {
  if (mode === "forward") {
    return length >= schema.forwardMinLength && length <= schema.forwardMaxLength;
  }
  return length >= schema.backwardMinLength && length <= schema.backwardMaxLength;
}

function isValidDigitSequence(sequence: number[], expectedLength: number): boolean {
  if (sequence.length !== expectedLength) {
    return false;
  }
  return sequence.every((digit) => Number.isInteger(digit) && digit >= 0 && digit <= 9);
}

function attemptKey(mode: DigitSpanMode, length: number, attemptIndex: number): string {
  return `${mode}:${length}:${attemptIndex}`;
}

function buildExpectedAttemptKeys(schema: DigitSpanMetricSchema): string[] {
  const keys: string[] = [];
  for (let length = schema.forwardMinLength; length <= schema.forwardMaxLength; length += 1) {
    for (let attemptIndex = 0; attemptIndex < schema.attemptsPerLength; attemptIndex += 1) {
      keys.push(attemptKey("forward", length, attemptIndex));
    }
  }
  for (let length = schema.backwardMinLength; length <= schema.backwardMaxLength; length += 1) {
    for (let attemptIndex = 0; attemptIndex < schema.attemptsPerLength; attemptIndex += 1) {
      keys.push(attemptKey("backward", length, attemptIndex));
    }
  }
  return keys;
}

function stringArraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

function arraysEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

export { DEFAULT_DIGIT_SPAN_SCHEMAS };
