import { and, eq, sql } from "drizzle-orm";

import type { Database } from "@/db";
import { trainingEvents, trainingProfileProjection, trainingSessions } from "@/db/schema";
import { rebuildTrainingProfileProjectionForTrainee } from "@/modules/training/trends.service";

export async function purgeTrainingPayloadsForStudent(
  tx: Database,
  studentId: string,
): Promise<number> {
  const result = await tx.execute(sql`
    UPDATE training_events
    SET payload = '{}'::jsonb
    FROM training_sessions
    WHERE training_events.session_id = training_sessions.id
      AND training_sessions.trainee_id = ${studentId}::uuid
      AND training_events.payload <> '{}'::jsonb
    RETURNING training_events.id
  `);

  return Array.isArray(result) ? result.length : 0;
}

export async function replayTrainingPayloadTombstoneForStudent(
  tx: Database,
  studentId: string,
): Promise<number> {
  return purgeTrainingPayloadsForStudent(tx, studentId);
}

export async function cleanupTrainingProjectionsForStudentDeletion(
  tx: Database,
  studentId: string,
  now?: Date,
): Promise<void> {
  await tx
    .delete(trainingProfileProjection)
    .where(eq(trainingProfileProjection.traineeId, studentId));

  await rebuildTrainingProfileProjectionForTrainee(tx, studentId, now);
}

export async function countNonEmptyTrainingPayloadsForStudent(
  tx: Database,
  studentId: string,
): Promise<number> {
  const rows = await tx
    .select({ id: trainingEvents.id })
    .from(trainingEvents)
    .innerJoin(trainingSessions, eq(trainingEvents.sessionId, trainingSessions.id))
    .where(
      and(eq(trainingSessions.traineeId, studentId), sql`${trainingEvents.payload} <> '{}'::jsonb`),
    );

  return rows.length;
}
