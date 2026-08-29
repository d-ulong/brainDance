import { addFamilyDays } from "@/modules/time-policy/add-family-days";
import { familyLocalInstant } from "@/modules/time-policy/family-local-instant";

const CORRECTION_WINDOW_DAYS = 7;

/**
 * Correction window spans 7 family natural days after the plan date.
 * Opens at start of familyDate+1 and closes at end of familyDate+7.
 */
export function correctionWindowEnd(familyDate: string): Date {
  const lastFamilyDate = addFamilyDays(familyDate, CORRECTION_WINDOW_DAYS);
  return familyLocalInstant(lastFamilyDate, "23:59:59.999");
}

export function correctionWindowStart(familyDate: string): Date {
  const firstFamilyDate = addFamilyDays(familyDate, 1);
  return familyLocalInstant(firstFamilyDate, "00:00:00.000");
}

export function isWithinCorrectionWindow(familyDate: string, now: Date): boolean {
  return (
    now.getTime() >= correctionWindowStart(familyDate).getTime() &&
    now.getTime() <= correctionWindowEnd(familyDate).getTime()
  );
}

export function isPastCorrectionWindow(familyDate: string, now: Date): boolean {
  return now.getTime() > correctionWindowEnd(familyDate).getTime();
}
