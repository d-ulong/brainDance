import { and, eq } from "drizzle-orm";

import type { Database } from "@/db";
import { trainingDefinitions } from "@/db/schema";
import { REACTION_TRAINING_KEY } from "@/modules/training/constants";
import { TrainingError } from "@/modules/training/errors";
import type { AgeBand } from "@/modules/time-policy/resolve-age-band";

export async function getActiveTrainingDefinition(
  db: Database,
  trainingKey: string,
  ageBand: AgeBand,
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

export async function seedReactionDefinitions(db: Database): Promise<void> {
  const ageBands: AgeBand[] = ["5-8", "9-12", "13-18"];

  for (const ageBand of ageBands) {
    await db
      .insert(trainingDefinitions)
      .values({
        trainingKey: REACTION_TRAINING_KEY,
        version: 1,
        ageBand,
        metricSchema: { trialCount: 5 },
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
}
