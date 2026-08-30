import type { TestDb } from "./db";
import {
  DIGIT_SPAN_TRAINING_KEY,
  REACTION_TRAINING_KEY,
  STROOP_COLORS,
  STROOP_TRAINING_KEY,
} from "@/modules/training/constants";
import { getDigitSpanSchemaForAgeBand } from "@/modules/training/digit-span-v1";
import { getStroopSchemaForAgeBand } from "@/modules/training/stroop-v1";
import { seedM5TrainingDefinitions } from "@/modules/training/definition.service";
import {
  appendTrainingEvent,
  startTrainingSession,
  submitTrainingSession,
} from "@/modules/training/session.service";

export async function ensureM5TrainingDefinitions(db: TestDb): Promise<void> {
  await seedM5TrainingDefinitions(db);
}

export async function ensureReactionDefinitions(db: TestDb): Promise<void> {
  await ensureM5TrainingDefinitions(db);
}

export async function completeReactionSession(
  db: TestDb,
  studentId: string,
  input?: {
    startIdempotencyKey?: string;
    submitIdempotencyKey?: string;
    reactionMs?: number;
    correctTrials?: number;
    trialCount?: number;
  },
) {
  await ensureM5TrainingDefinitions(db);

  const trialCount = input?.trialCount ?? 5;
  const reactionMs = input?.reactionMs ?? 350;
  const correctTrials = input?.correctTrials ?? trialCount;

  const started = await startTrainingSession(db, {
    studentId,
    trainingKey: REACTION_TRAINING_KEY,
    idempotencyKey: input?.startIdempotencyKey ?? `start-${crypto.randomUUID()}`,
  });

  let sequence = 0;
  for (let trialIndex = 0; trialIndex < trialCount; trialIndex += 1) {
    await appendTrainingEvent(db, {
      studentId,
      sessionId: started.sessionId,
      sequence,
      eventType: "trial.stimulus",
      payload: { trialIndex, stimulusId: `s-${trialIndex}` },
    });
    sequence += 1;

    await new Promise((resolve) => setTimeout(resolve, reactionMs));

    await appendTrainingEvent(db, {
      studentId,
      sessionId: started.sessionId,
      sequence,
      eventType: "trial.response",
      payload: {
        trialIndex,
        correct: trialIndex < correctTrials,
        inputMethod: "keyboard",
      },
    });
    sequence += 1;
  }

  const submitted = await submitTrainingSession(db, {
    studentId,
    sessionId: started.sessionId,
    idempotencyKey: input?.submitIdempotencyKey ?? `submit-${crypto.randomUUID()}`,
  });

  return { started, submitted };
}

export async function completeStroopSession(
  db: TestDb,
  studentId: string,
  input?: {
    ageBand?: "5-8" | "9-12" | "13-18";
    startIdempotencyKey?: string;
    submitIdempotencyKey?: string;
    reactionMs?: number;
  },
) {
  await ensureM5TrainingDefinitions(db);

  const started = await startTrainingSession(db, {
    studentId,
    trainingKey: STROOP_TRAINING_KEY,
    idempotencyKey: input?.startIdempotencyKey ?? `stroop-start-${crypto.randomUUID()}`,
  });

  const schema = getStroopSchemaForAgeBand(input?.ageBand ?? started.ageBand);
  const reactionMs = input?.reactionMs ?? 400;
  let sequence = 0;

  for (let trialIndex = 0; trialIndex < schema.trialCount; trialIndex += 1) {
    const congruent = trialIndex < schema.congruentQuota;
    const inkColor = STROOP_COLORS[0]!;
    const wordColor = congruent ? inkColor : STROOP_COLORS[1]!;

    await appendTrainingEvent(db, {
      studentId,
      sessionId: started.sessionId,
      sequence,
      eventType: "trial.stimulus",
      payload: { trialIndex, inkColor, wordColor },
    });
    sequence += 1;

    await new Promise((resolve) => setTimeout(resolve, reactionMs));

    await appendTrainingEvent(db, {
      studentId,
      sessionId: started.sessionId,
      sequence,
      eventType: "trial.response",
      payload: { trialIndex, selectedColor: inkColor, inputMethod: "keyboard" },
    });
    sequence += 1;
  }

  const submitted = await submitTrainingSession(db, {
    studentId,
    sessionId: started.sessionId,
    idempotencyKey: input?.submitIdempotencyKey ?? `stroop-submit-${crypto.randomUUID()}`,
  });

  return { started, submitted };
}

export async function completeDigitSpanSession(
  db: TestDb,
  studentId: string,
  input?: {
    ageBand?: "5-8" | "9-12" | "13-18";
    startIdempotencyKey?: string;
    submitIdempotencyKey?: string;
    responses?: Record<string, number[]>;
  },
) {
  await ensureM5TrainingDefinitions(db);

  const started = await startTrainingSession(db, {
    studentId,
    trainingKey: DIGIT_SPAN_TRAINING_KEY,
    idempotencyKey: input?.startIdempotencyKey ?? `digit-start-${crypto.randomUUID()}`,
  });

  const schema = getDigitSpanSchemaForAgeBand(input?.ageBand ?? started.ageBand);
  let sequence = 0;

  const emitAttempt = (
    mode: "forward" | "backward",
    length: number,
    attemptIndex: number,
    digits: number[],
  ) => {
    const key = `${mode}:${length}:${attemptIndex}`;
    const response =
      input?.responses?.[key] ?? (mode === "forward" ? digits : [...digits].reverse());
    return { mode, length, attemptIndex, digits, response };
  };

  const attempts = [];
  for (let length = schema.forwardMinLength; length <= schema.forwardMaxLength; length += 1) {
    for (let attemptIndex = 0; attemptIndex < schema.attemptsPerLength; attemptIndex += 1) {
      attempts.push(
        emitAttempt(
          "forward",
          length,
          attemptIndex,
          Array.from({ length }, (_, index) => index + 1),
        ),
      );
    }
  }
  for (let length = schema.backwardMinLength; length <= schema.backwardMaxLength; length += 1) {
    for (let attemptIndex = 0; attemptIndex < schema.attemptsPerLength; attemptIndex += 1) {
      attempts.push(
        emitAttempt(
          "backward",
          length,
          attemptIndex,
          Array.from({ length }, (_, index) => index + 2),
        ),
      );
    }
  }

  for (const attempt of attempts) {
    await appendTrainingEvent(db, {
      studentId,
      sessionId: started.sessionId,
      sequence,
      eventType: "span.stimulus",
      payload: {
        mode: attempt.mode,
        length: attempt.length,
        attemptIndex: attempt.attemptIndex,
        sequence: attempt.digits,
      },
    });
    sequence += 1;

    await appendTrainingEvent(db, {
      studentId,
      sessionId: started.sessionId,
      sequence,
      eventType: "span.response",
      payload: {
        mode: attempt.mode,
        length: attempt.length,
        attemptIndex: attempt.attemptIndex,
        sequence: attempt.digits,
        response: attempt.response,
      },
    });
    sequence += 1;
  }

  const submitted = await submitTrainingSession(db, {
    studentId,
    sessionId: started.sessionId,
    idempotencyKey: input?.submitIdempotencyKey ?? `digit-submit-${crypto.randomUUID()}`,
  });

  return { started, submitted };
}
