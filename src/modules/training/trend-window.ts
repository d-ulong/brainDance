import { addFamilyDays } from "@/modules/time-policy/add-family-days";
import { toFamilyDate } from "@/modules/time-policy/to-family-date";

export type TrendWindow = "7d" | "30d" | "all";

const WINDOW_INCLUSIVE_DAYS: Record<Exclude<TrendWindow, "all">, number> = {
  "7d": 7,
  "30d": 30,
};

export function resolveTrendWindowStart(
  window: TrendWindow,
  referenceFamilyDate: string = toFamilyDate(),
): string | null {
  if (window === "all") {
    return null;
  }

  return addFamilyDays(referenceFamilyDate, -(WINDOW_INCLUSIVE_DAYS[window] - 1));
}

export function isFamilyDateInTrendWindow(
  familyDate: string,
  window: TrendWindow,
  referenceFamilyDate: string = toFamilyDate(),
): boolean {
  if (window === "all") {
    return true;
  }

  const start = resolveTrendWindowStart(window, referenceFamilyDate);
  if (!start) {
    return true;
  }

  return familyDate >= start && familyDate <= referenceFamilyDate;
}
