import { and, eq } from "drizzle-orm";

import type { Database } from "@/db";
import { trainingDefinitions } from "@/db/schema";
import {
  DIGIT_SPAN_TRAINING_KEY,
  REACTION_TRAINING_KEY,
  STROOP_TRAINING_KEY,
} from "@/modules/training/constants";
import { DEFAULT_DIGIT_SPAN_SCHEMAS } from "@/modules/training/digit-span-v1";
import { DEFAULT_STROOP_SCHEMAS } from "@/modules/training/stroop-v1";
import { TrainingError } from "@/modules/training/errors";
import type { AgeBand } from "@/modules/time-policy/resolve-age-band";
import { ADULT_AGE_BAND, type TrainingAgeBand } from "@/modules/training/training-subject";

export async function getActiveTrainingDefinition(
  db: Database,
  trainingKey: string,
  ageBand: TrainingAgeBand,
) {
  const [definition] = await db
    .select()
    .from(trainingDefinitions)
    .where(
      and(
        eq(trainingDefinitions.trainingKey, trainingKey),
        eq(trainingDefinitions.ageBand, ageBand),
        eq(trainingDefinitions.active, 1),
      ),
    )
    .limit(1);

  if (!definition) {
    throw new TrainingError(
      "TRAINING_DEFINITION_NOT_FOUND",
      `No active definition for ${trainingKey} / ${ageBand}`,
    );
  }

  return definition;
}

export async function getTrainingDefinitionById(db: Database, definitionId: string) {
  const [definition] = await db
    .select()
    .from(trainingDefinitions)
    .where(eq(trainingDefinitions.id, definitionId))
    .limit(1);

  if (!definition) {
    throw new TrainingError("TRAINING_DEFINITION_NOT_FOUND", "Training definition not found");
  }

  return definition;
}

export async function getSessionTrainingDefinition(
  db: Database,
  session: {
    definitionId: string;
    trainingKey: string;
    definitionVersion: number;
    ageBand: string;
  },
) {
  const definition = await getTrainingDefinitionById(db, session.definitionId);

  if (definition.trainingKey !== session.trainingKey) {
    throw new TrainingError(
      "TRAINING_DEFINITION_NOT_FOUND",
      "Session definition training key mismatch",
    );
  }
  if (definition.version !== session.definitionVersion) {
    throw new TrainingError("TRAINING_DEFINITION_NOT_FOUND", "Session definition version mismatch");
  }
  if (definition.ageBand !== session.ageBand) {
    throw new TrainingError(
      "TRAINING_DEFINITION_NOT_FOUND",
      "Session definition age band mismatch",
    );
  }

  return definition;
}

const CHILD_AGE_BANDS: AgeBand[] = ["5-8", "9-12", "13-18"];

async function seedDefinitionRow(
  db: Database,
  trainingKey: string,
  ageBand: TrainingAgeBand,
  metricSchema: Record<string, unknown>,
): Promise<void> {
  await db
    .insert(trainingDefinitions)
    .values({
      trainingKey,
      version: 1,
      ageBand,
      metricSchema,
      active: 1,
    })
    .onConflictDoNothing({
      target: [
        trainingDefinitions.trainingKey,
        trainingDefinitions.version,
        trainingDefinitions.ageBand,
      ],
    });
}

async function seedDefinitionForKey(
  db: Database,
  trainingKey: string,
  metricSchemaForAgeBand: (ageBand: TrainingAgeBand) => Record<string, unknown>,
): Promise<void> {
  for (const ageBand of CHILD_AGE_BANDS) {
    await seedDefinitionRow(db, trainingKey, ageBand, metricSchemaForAgeBand(ageBand));
  }
  await seedDefinitionRow(db, trainingKey, ADULT_AGE_BAND, metricSchemaForAgeBand(ADULT_AGE_BAND));
}

export async function seedReactionDefinitions(db: Database): Promise<void> {
  await seedDefinitionForKey(db, REACTION_TRAINING_KEY, () => ({ trialCount: 5 }));
}

export async function seedStroopDefinitions(db: Database): Promise<void> {
  await seedDefinitionForKey(db, STROOP_TRAINING_KEY, (ageBand) => ({
    ...DEFAULT_STROOP_SCHEMAS[ageBand],
  }));
}

export async function seedDigitSpanDefinitions(db: Database): Promise<void> {
  await seedDefinitionForKey(db, DIGIT_SPAN_TRAINING_KEY, (ageBand) => ({
    ...DEFAULT_DIGIT_SPAN_SCHEMAS[ageBand],
  }));
}

export async function seedM5TrainingDefinitions(db: Database): Promise<void> {
  await seedReactionDefinitions(db);
  await seedStroopDefinitions(db);
  await seedDigitSpanDefinitions(db);
}
