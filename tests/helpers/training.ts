import type { TestDb } from "./db";
import { REACTION_TRAINING_KEY } from "@/modules/training/constants";
import {
  appendTrainingEvent,
  startTrainingSession,
  submitTrainingSession,
} from "@/modules/training/session.service";
import { seedReactionDefinitions } from "@/modules/training/definition.service";

export async function ensureReactionDefinitions(db: TestDb): Promise<void> {
  await seedReactionDefinitions(db);
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
  await ensureReactionDefinitions(db);

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
    const stimulus = await appendTrainingEvent(db, {
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

    void stimulus;
  }

  const submitted = await submitTrainingSession(db, {
    studentId,
    sessionId: started.sessionId,
    idempotencyKey: input?.submitIdempotencyKey ?? `submit-${crypto.randomUUID()}`,
  });

  return { started, submitted };
}
