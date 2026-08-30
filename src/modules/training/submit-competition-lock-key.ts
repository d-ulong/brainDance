export function buildSubmitCompetitionLockKey(
  studentId: string,
  trainingKey: string,
  familyDate: string,
): string {
  return `${studentId}:${trainingKey}:${familyDate}`;
}
