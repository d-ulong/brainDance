import { eq } from "drizzle-orm";

import type { Database } from "@/db";
import { users } from "@/db/schema";
import { TrainingError } from "@/modules/training/errors";
import { resolveAgeBand, type AgeBand } from "@/modules/time-policy/resolve-age-band";

export type TraineeRole = "student" | "parent";

export type TrainingAgeBand = AgeBand | "adult";

export type TrainingSubject = {
  traineeId: string;
  traineeRole: TraineeRole;
  ageBand: TrainingAgeBand;
};

export const ADULT_AGE_BAND: TrainingAgeBand = "adult";

export async function resolveTrainingSubject(
  db: Database,
  userId: string,
): Promise<TrainingSubject> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) {
    throw new TrainingError("USER_NOT_FOUND", "Training subject not found");
  }

  if (user.role === "student") {
    if (!user.birthDate) {
      throw new TrainingError("STUDENT_BIRTH_DATE_REQUIRED", "Student birth date is required");
    }
    return {
      traineeId: user.id,
      traineeRole: "student",
      ageBand: resolveAgeBand(new Date(`${user.birthDate}T12:00:00.000Z`)),
    };
  }

  if (user.role === "parent") {
    return {
      traineeId: user.id,
      traineeRole: "parent",
      ageBand: ADULT_AGE_BAND,
    };
  }

  throw new TrainingError("FORBIDDEN", "Only students or parents can train");
}

export function compatStudentIdForSubject(subject: TrainingSubject): string | null {
  return subject.traineeRole === "student" ? subject.traineeId : null;
}
