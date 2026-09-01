import type { Database } from "@/db";
import { rebuildProjectionForStudent } from "@/modules/projection/rebuild-projection.service";
import { cleanupTrainingProjectionsForStudentDeletion } from "@/modules/training/account-deletion.service";

export async function resetProjectionsAfterStudentDeletion(
  tx: Database,
  input: { studentId: string; now: Date },
): Promise<void> {
  await cleanupTrainingProjectionsForStudentDeletion(tx, input.studentId, input.now);
  await rebuildProjectionForStudent(tx, input.studentId, input.now);
}
